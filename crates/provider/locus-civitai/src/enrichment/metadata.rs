use super::{Captured, Enrichment, EnrichmentState, MetadataState, uncertain};
use crate::{
    error::CivitaiError,
    identity::{CIVITAI_KIND, CivitaiId},
    persistence,
    record::CivitaiRecord,
    service::CivitaiService,
    snapshot::Snapshot,
};
use locus_core::api::{ComponentId, EntityId, Kernel, Membership};
use locus_file::api::{CurrentInput, FileId, FileService, observe_input_in};
use locus_store::api::{Context, Session};
use std::io::Read;

pub(crate) async fn capture(
    k: &Kernel,
    c: &mut Context,
    host: EntityId,
    file: FileId,
) -> Result<Captured, CivitaiError> {
    if observe_input_in(k, c, host).await? != CurrentInput::File(file) {
        return Err(CivitaiError::Conflict);
    }
    FileService::read_in(c, file).await?;
    let slot = k
        .memberships_in(c, host)
        .await?
        .into_iter()
        .find(|m| m.kind == CIVITAI_KIND);
    let slot = match slot {
        Some(m) => {
            let id = CivitaiId::from_component(m.component);
            Some((id, CivitaiService::read_in(c, id).await?.revision))
        }
        None => None,
    };
    Ok(Captured { host, file, slot })
}
impl CivitaiService {
    pub(crate) async fn metadata(
        &self,
        k: &Kernel,
        files: &FileService,
        s: &mut Session,
        work: &mut Enrichment,
    ) -> Result<(), CivitaiError> {
        if work.metadata == MetadataState::NoMatch {
            return Ok(());
        }
        if work.metadata == MetadataState::Uncertain {
            let candidate = work
                .candidate
                .as_ref()
                .ok_or(CivitaiError::Conflict)?
                .clone();
            let kernel = k.clone();
            let host = work.entity;
            let file = work.file;
            let confirmed = s
                .transaction_named("Confirm original Civitai metadata", move |c| {
                    Box::pin(async move {
                        let current = capture(&kernel, c, host, file).await?;
                        if current.slot != Some((candidate.id, candidate.revision)) {
                            return Err(CivitaiError::Conflict);
                        }
                        let actual = Self::read_in(c, candidate.id).await?;
                        if actual != candidate {
                            return Err(CivitaiError::Conflict);
                        }
                        Ok(actual)
                    })
                })
                .await?;
            work.record = Some(confirmed);
            work.metadata = MetadataState::Accepted;
            work.effect += 1;
            return Ok(());
        }
        if work.metadata == MetadataState::Accepted {
            return self.validate_metadata(k, s, work).await;
        }
        let kernel = k.clone();
        let host = work.entity;
        let file = work.file;
        let first = work.first_only;
        let captured = s
            .transaction_named("Capture intended Civitai input", move |c| {
                Box::pin(async move {
                    let observed = capture(&kernel, c, host, file).await?;
                    if first && observed.slot.is_some() {
                        return Err(CivitaiError::Conflict);
                    }
                    Ok(observed)
                })
            })
            .await?;
        // Retrying a failed acquisition may repeat remote reads but never adopts a
        // different slot or a refreshed revision from another operation.
        if work.captured.as_ref().is_some_and(|old| old != &captured) {
            return Err(CivitaiError::Conflict);
        }
        work.captured = Some(captured.clone());
        let mut input = files.open(s, file).await?;
        let stage = match s.task_context() {
            Some(t) => Some(t.enter("Civitai BLAKE3 matching", &[]).await?),
            None => None,
        };
        let mut hash = move || -> Result<[u8; 32], CivitaiError> {
            let mut hasher = blake3::Hasher::new();
            let mut bytes = [0; 64 * 1024];
            loop {
                let count = input.read(&mut bytes)?;
                if count == 0 {
                    break;
                }
                hasher.update(&bytes[..count]);
            }
            Ok(*hasher.finalize().as_bytes())
        };
        let worker = match &stage {
            Some(stage) => stage.spawn_blocking(move |_| hash()),
            None => tokio::task::spawn_blocking(hash),
        };
        let digest = worker
            .await
            .map_err(|e| CivitaiError::Worker(e.to_string()))??;
        drop(stage);
        let stage = match s.task_context() {
            Some(t) => Some(t.enter("Civitai metadata acquisition", &[]).await?),
            None => None,
        };
        let Some(lookup) = self.upstream.by_hash(digest).await? else {
            work.metadata = MetadataState::NoMatch;
            drop(stage);
            return Ok(());
        };
        let model_id = lookup
            .model_id
            .ok_or_else(|| CivitaiError::Invalid("lookup has no parent model identity".into()))?;
        let model = self.upstream.model(model_id).await?;
        let hex = blake3::Hash::from_bytes(digest).to_hex().to_string();
        let matching: Vec<_> = lookup
            .files
            .iter()
            .filter(|f| {
                f.hashes
                    .iter()
                    .any(|(k, v)| k.eq_ignore_ascii_case("BLAKE3") && v.eq_ignore_ascii_case(&hex))
            })
            .collect();
        if matching.len() != 1 {
            return Err(CivitaiError::Invalid(
                "lookup does not identify exactly one concrete file".into(),
            ));
        }
        let matched_file = matching[0].id;
        let matched_version = lookup.id;
        let snapshot = Snapshot {
            model,
            lookup,
            matched_version,
            matched_file,
            blake3: hex,
        };
        snapshot.validate()?;
        drop(stage);
        let revision = match captured.slot {
            Some((_, r)) => r
                .checked_add(1)
                .ok_or_else(|| CivitaiError::Invalid("revision exhausted".into()))?,
            None => 0,
        };
        let examples = if let Some((id, _)) = captured.slot {
            let kernel = k.clone();
            let next = snapshot.clone();
            s.transaction_named("Observe refresh example carry-forward", move |c| {
                Box::pin(async move {
                    let old = Self::read_in(c, id).await?;
                    let mut carried = Vec::new();
                    if old.snapshot.model.id == next.model.id
                        && old.snapshot.matched_version == next.matched_version
                    {
                        for (occurrence, image) in next.matched()?.images.iter().enumerate() {
                            if image.id.is_none()
                                || next
                                    .matched()?
                                    .images
                                    .iter()
                                    .filter(|v| v.id == image.id)
                                    .count()
                                    != 1
                            {
                                continue;
                            }
                            for binding in &old.examples {
                                if &binding.representation != image || !binding.complete {
                                    continue;
                                }
                                match crate::examples::validate_binding_in(
                                    &kernel, c, binding, true,
                                )
                                .await
                                {
                                    Ok(()) => {
                                        let mut binding = binding.clone();
                                        binding.occurrence = occurrence;
                                        carried.push(binding);
                                        break;
                                    }
                                    Err(CivitaiError::Conflict) => {}
                                    Err(e) => return Err(e),
                                }
                            }
                        }
                    }
                    Ok(carried)
                })
            })
            .await?
        } else {
            Vec::new()
        };
        let candidate = CivitaiRecord {
            id: captured
                .slot
                .map(|s| s.0)
                .unwrap_or_else(|| CivitaiId::from_component(ComponentId::new())),
            revision,
            observation: uuid::Uuid::now_v7().to_string(),
            basis: file,
            snapshot,
            examples,
        };
        work.candidate = Some(candidate.clone());
        let kernel = k.clone();
        let accepted = candidate.clone();
        let result = s
            .transaction_named("Accept complete Civitai metadata", move |c| {
                Box::pin(async move {
                    if capture(&kernel, c, host, file).await? != captured {
                        return Err(CivitaiError::Conflict);
                    }
                    for binding in &accepted.examples {
                        crate::examples::validate_binding_in(&kernel, c, binding, true).await?;
                    }
                    if captured.slot.is_some() {
                        persistence::update(c, &accepted).await?;
                    } else {
                        persistence::insert(c, &accepted).await?;
                        kernel
                            .admit_component_in(c, CIVITAI_KIND, accepted.id.component())
                            .await?;
                        kernel
                            .attach_in(
                                c,
                                Membership {
                                    entity: host,
                                    kind: CIVITAI_KIND,
                                    component: accepted.id.component(),
                                },
                            )
                            .await?;
                    }
                    Ok(())
                })
            })
            .await;
        match result {
            Ok(()) => {
                work.record = Some(candidate);
                work.metadata = MetadataState::Accepted;
                work.effect += 1;
                Ok(())
            }
            Err(e) => {
                if uncertain(&e) {
                    work.metadata = MetadataState::Uncertain;
                }
                Err(e)
            }
        }
    }
    pub(crate) async fn validate_metadata(
        &self,
        k: &Kernel,
        s: &mut Session,
        work: &Enrichment,
    ) -> Result<(), CivitaiError> {
        let expected = work.record.as_ref().ok_or(CivitaiError::Conflict)?.clone();
        let host = work.entity;
        let file = work.file;
        let kernel = k.clone();
        s.transaction_named("Validate original Civitai observation", move |c| {
            Box::pin(async move {
                let actual = capture(&kernel, c, host, file).await?;
                if actual.slot != Some((expected.id, expected.revision)) {
                    return Err(CivitaiError::Conflict);
                }
                let record = Self::read_in(c, expected.id).await?;
                if record.observation != expected.observation || record.basis != expected.basis {
                    return Err(CivitaiError::Conflict);
                }
                Ok(())
            })
        })
        .await
    }
}
pub(crate) fn fail(work: &mut Enrichment, e: &CivitaiError) {
    work.problem = Some(e.to_string());
    work.state = if uncertain(e)
        || work.metadata == MetadataState::Uncertain
        || work
            .examples
            .iter()
            .any(|x| x.outcome.state == crate::examples::ExampleState::Uncertain)
    {
        EnrichmentState::Uncertain
    } else if matches!(e, CivitaiError::Conflict)
        || work
            .examples
            .iter()
            .any(|x| x.outcome.state == crate::examples::ExampleState::Conflict)
    {
        EnrichmentState::Conflict
    } else {
        EnrichmentState::Failed
    };
    if work.metadata != MetadataState::Accepted
        && work.metadata != MetadataState::Uncertain
        && work.metadata != MetadataState::NoMatch
    {
        work.metadata = if work.state == EnrichmentState::Conflict {
            MetadataState::Conflict
        } else {
            MetadataState::Failed
        };
    }
}
