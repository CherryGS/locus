use super::{
    record::{Publication, QueryContext, SearchRequest, SearchResult},
    worker::Worker,
};
use crate::{error::SearchError, journal};
use locus_core::api::EntityId;
use locus_query::api::Program;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tantivy::{ReloadPolicy, Searcher, Term};

impl Worker {
    pub(super) async fn observe(&self) -> Result<crate::discovery::Observation, SearchError> {
        let (searcher, publication, _) = self.capture(Vec::new()).await?;
        let context = uuid::Uuid::now_v7().to_string();
        let result = crate::discovery::Observation {
            context: context.clone(),
            generation: publication.checkpoint.generation.clone(),
            covered_sequence: publication.checkpoint.covered.to_string(),
            expires_after_seconds: crate::discovery::LIFETIME_SECONDS,
            matching_policy: crate::discovery::MATCHING_POLICY.into(),
        };
        self.shared
            .discoveries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(
                context,
                Arc::new(crate::discovery::DiscoveryContext {
                    searcher,
                    _publication: publication,
                    expires: Instant::now()
                        + Duration::from_secs(crate::discovery::LIFETIME_SECONDS),
                    fields: Mutex::new(HashMap::new()),
                    cursors: Mutex::new(HashMap::new()),
                }),
            );
        Ok(result)
    }
    async fn capture(
        &self,
        roots: Vec<locus_query::api::ReferenceOperand>,
    ) -> Result<(Searcher, Publication, crate::reference::Bindings), SearchError> {
        let worker = self.clone();
        self.queue
            .submit(
                "Capture aligned Search observation",
                move |task| async move {
                    let protected = worker.database.protect(&task).await?;
                    #[cfg(test)]
                    {
                        let pause = worker
                            .shared
                            .admission_pause
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .take();
                        if let Some((entered, release)) = pause {
                            entered.notify_one();
                            release.notified().await;
                        }
                    }
                    let mut session = protected.session().await?;
                    let mut publication = worker
                        .shared
                        .publication
                        .read()
                        .unwrap_or_else(|e| e.into_inner())
                        .clone()
                        .ok_or_else(|| SearchError::Unavailable("index is not ready".into()))?;
                    loop {
                        worker.check_stop()?;
                        let after = publication.checkpoint.covered;
                        let providers = worker.providers.clone();
                        let kernel = worker.kernel.clone();
                        let (covered, projected) = session
                            .transaction(move |c| {
                                Box::pin(async move {
                                    let (covered, ids) = journal::pending(c, after).await?;
                                    Ok::<_, SearchError>((
                                        covered,
                                        providers.project(c, &kernel, &ids).await?,
                                    ))
                                })
                            })
                            .await?;
                        if covered == after {
                            break;
                        }
                        let mut writer = worker.writer(&publication.index)?;
                        for (id, value) in projected {
                            writer.get()?.delete_term(Term::from_field_text(
                                worker.mapping.id,
                                &id.to_string(),
                            ));
                            if let Some(value) = value {
                                writer
                                    .get()?
                                    .add_document(worker.mapping.document(id, &value)?)?;
                            }
                        }
                        publication.checkpoint.covered = covered;
                        worker.commit(&mut writer, &publication.checkpoint)?;
                        drop(writer);
                        publication.reader = publication
                            .index
                            .reader_builder()
                            .reload_policy(ReloadPolicy::Manual)
                            .try_into()?;
                        session
                            .transaction(move |c| Box::pin(journal::acknowledge(c, covered)))
                            .await?;
                    }
                    let boundary = session
                        .transaction(|c| Box::pin(journal::boundary(c)))
                        .await?;
                    worker.status(|s| {
                        s.journal_head = boundary
                            .head
                            .max(s.journal_head.parse::<i64>().unwrap_or(0))
                            .to_string()
                    });
                    worker.publish(publication.clone());
                    let searcher = publication.reader.searcher();
                    let providers = worker.providers.clone();
                    let bindings = session
                        .transaction(move |c| {
                            Box::pin(async move { providers.resolve(c, roots).await })
                        })
                        .await?;
                    // Both reference closure and aligned Searcher are captured under actual DB exclusion.
                    drop(session);
                    drop(protected);
                    Ok((searcher, publication, bindings))
                },
            )?
            .result()
            .await?
    }
    pub(super) async fn admit(
        &self,
        program: Program,
        typed: Option<SearchRequest>,
    ) -> Result<SearchResult, SearchError> {
        let worker = self.clone();
        self.queue
            .submit("Align Filter query", move |_task| async move {
                let mut roots = std::collections::BTreeSet::new();
                let text = typed
                    .as_ref()
                    .map_or(program.source.text.as_str(), |r| r.text.as_str());
                if !text.trim().is_empty() {
                    crate::reference::collect_native(
                        &crate::compiler::parse(text)?,
                        &worker.providers.catalogue,
                        &mut roots,
                    )?;
                }
                if let Some(condition) = typed.as_ref().and_then(|r| r.filter.as_ref()) {
                    crate::reference::collect_typed(
                        condition,
                        &worker.providers.catalogue,
                        &mut roots,
                    )?;
                }
                let (searcher, publication, bindings) =
                    worker.capture(roots.into_iter().collect()).await?;
                let query = if let Some(request) = &typed {
                    crate::compiler::compile_bound(
                        &publication.index,
                        &worker.mapping,
                        &worker.providers.catalogue,
                        &request.text,
                        request.filter.as_ref(),
                        &bindings,
                    )?
                } else {
                    crate::compiler::program_bound(
                        &publication.index,
                        &worker.mapping,
                        &program,
                        Some(&bindings),
                    )?
                };
                let mut hits =
                    searcher.search(&*query, &crate::collector::Complete { scoring: true })?;
                hits.sort_unstable_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
                let mut bytes = Vec::with_capacity(hits.len() * 16);
                for (_, id) in hits {
                    EntityId::from_bytes(&id).map_err(|e| SearchError::Invalid(e.to_string()))?;
                    bytes.extend_from_slice(&id);
                }
                let context = uuid::Uuid::now_v7().to_string();
                let result = SearchResult {
                    bytes,
                    context: context.clone(),
                    generation: publication.checkpoint.generation.clone(),
                    covered_sequence: publication.checkpoint.covered.to_string(),
                    expires_after_seconds: 600,
                };
                let mut contexts = worker
                    .shared
                    .contexts
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                contexts.retain(|_, c| c.expires > Instant::now());
                contexts.insert(
                    context,
                    Arc::new(QueryContext {
                        searcher,
                        publication,
                        bindings,
                        program: if typed.is_none() { Some(program) } else { None },
                        request: typed.unwrap_or(SearchRequest {
                            text: String::new(),
                            filter: None,
                        }),
                        expires: Instant::now() + Duration::from_secs(600),
                    }),
                );
                Ok(result)
            })?
            .result()
            .await?
    }
}
