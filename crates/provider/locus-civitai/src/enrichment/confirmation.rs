use super::{Enrichment, EnrichmentState, MetadataState};
use crate::{error::CivitaiError, examples::ExampleState, service::CivitaiService};
use locus_core::api::Kernel;
use locus_file::api::{CurrentInput, FileService, observe_input_in};
use locus_store::api::Session;
impl CivitaiService {
    /// Confirms known original effects without hashing, acquisition or creating work.
    pub async fn confirm(
        &self,
        k: &Kernel,
        files: &FileService,
        s: &mut Session,
        w: &mut Enrichment,
    ) {
        let result: Result<(), CivitaiError> = async {
            if w.metadata == MetadataState::Uncertain {
                self.metadata(k, files, s, w).await?;
            }
            if w.metadata == MetadataState::Accepted {
                self.validate_metadata(k, s, w).await?;
            }
            for e in &mut w.examples {
                if e.registration_uncertain {
                    let p = e.prepared.as_ref().ok_or(CivitaiError::Conflict)?;
                    let r = files.read(s, p.id()).await?;
                    if r.byte_count != p.progress().bytes_written
                        || r.relative_path != p.progress().relative_path
                    {
                        return Err(CivitaiError::Conflict);
                    }
                    e.registered = true;
                    e.registration_uncertain = false;
                }
                if e.target_uncertain {
                    let entity = e.target_candidate.ok_or(CivitaiError::Conflict)?;
                    let file = e.prepared.as_ref().ok_or(CivitaiError::Conflict)?.id();
                    let kernel = k.clone();
                    s.transaction(move |c| {
                        Box::pin(async move {
                            if observe_input_in(&kernel, c, entity).await?
                                != CurrentInput::File(file)
                            {
                                return Err(CivitaiError::Conflict);
                            }
                            Ok(())
                        })
                    })
                    .await?;
                    e.target_uncertain = false;
                }
                if e.component_uncertain || !e.interpretation_uncertain.is_empty() {
                    let binding = e
                        .outcome
                        .binding
                        .as_ref()
                        .ok_or(CivitaiError::Conflict)?
                        .clone();
                    let kernel = k.clone();
                    let parts = e.components.clone();
                    let records = s
                        .transaction(move |c| {
                            Box::pin(async move {
                                let mut b = binding;
                                b.media = parts;
                                crate::examples::validate_binding_in(&kernel, c, &b, false).await?;
                                let mut records = Vec::new();
                                for part in &b.media {
                                    records.push(
                                        locus_media::api::MediaService::read_in(c, part.id())
                                            .await?,
                                    );
                                }
                                Ok::<_, CivitaiError>(records)
                            })
                        })
                        .await?;
                    for part in &e.components {
                        if e.interpretation_uncertain.contains(&part.id()) {
                            let actual = records
                                .iter()
                                .find(|r| r.id == part.id())
                                .ok_or(CivitaiError::Conflict)?;
                            if actual.revision <= part.revision {
                                return Err(CivitaiError::Invalid(
                                    "Original interpretation result remains unconfirmed".into(),
                                ));
                            }
                            e.interpretation_uncertain.retain(|id| *id != part.id());
                        }
                    }
                    e.component_uncertain = false;
                }
                if e.relationship_uncertain {
                    let expected = e.outcome.binding.as_ref().ok_or(CivitaiError::Conflict)?;
                    let record = w.record.as_ref().ok_or(CivitaiError::Conflict)?;
                    let actual = self.read(s, record.id).await?;
                    if actual.observation != record.observation
                        || !actual.examples.iter().any(|b| b == expected)
                    {
                        return Err(CivitaiError::Conflict);
                    }
                    e.relationship_uncertain = false;
                    e.relationship_confirmed = true;
                }
                if e.outcome.state == ExampleState::Uncertain
                    && e.interpretation_uncertain.is_empty()
                {
                    e.outcome.state = if e.outcome.binding.as_ref().is_some_and(|b| b.complete) {
                        ExampleState::Complete
                    } else {
                        ExampleState::Failed
                    };
                }
            }
            Ok(())
        }
        .await;
        match result {
            Err(e) => super::fail(w, &e),
            Ok(()) => {
                w.effect += 1;
                w.problem = None;
                match self.validate_completion(k, s, w).await {
                    Ok(()) => w.state = EnrichmentState::Complete,
                    Err(e) => super::fail(w, &e),
                }
            }
        }
    }
}
