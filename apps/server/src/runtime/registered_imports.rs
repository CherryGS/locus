use super::{
    registry::{Binding, Shared},
    submissions::{Arguments, check},
};
use crate::{
    api::{
        dto::{Submission, TaskOutcome},
        error::{ApiError, ErrorCode},
        imports::dto::RegisteredImportRequest,
    },
    imports::Action,
};
use locus_file::api::{FileId, FileService};
use std::sync::Arc;

impl Shared {
    /// Claim before state-dependent reads. A detached task owns validation even
    /// when the HTTP handler disappears; drain includes its actual worker lifetime.
    pub fn registered_import(
        self: &Arc<Self>,
        request: RegisteredImportRequest,
    ) -> Result<Submission, ApiError> {
        let domain = self.business()?.clone();
        let arguments = Arguments::RegisteredImport(request.clone());
        let mut registry = self.lock();
        if let Some(binding) = registry.requests.get(&request.request_id) {
            check(binding, &arguments)?;
            return Ok(binding.result.clone());
        }
        self.admit(&mut registry)?;
        let id = request.request_id.clone();
        registry.requests.insert(
            id.clone(),
            Binding {
                arguments: arguments.clone(),
                result: Submission::AdmissionPending,
            },
        );
        let inputs = (|| {
            if request.items.is_empty() {
                return Err(ApiError::invalid("At least one import item is required"));
            }
            request
                .items
                .into_iter()
                .map(|item| {
                    if item.file_id.is_none() && item.twitter.is_none() {
                        return Err(ApiError::invalid(
                            "An item requires a registered File or Twitter snapshot",
                        ));
                    }
                    let file = item
                        .file_id
                        .map(|v| {
                            let parsed = uuid::Uuid::parse_str(&v)
                                .map_err(|e| ApiError::invalid(e.to_string()))?;
                            if parsed.to_string() != v {
                                return Err(ApiError::invalid("File identity must be canonical"));
                            }
                            FileId::from_bytes(
                                uuid::Uuid::parse_str(&v)
                                    .map_err(|e| ApiError::invalid(e.to_string()))?
                                    .as_bytes(),
                            )
                            .map_err(|e| ApiError::invalid(e.to_string()))
                        })
                        .transpose()?;
                    let snapshot = item
                        .twitter
                        .map(crate::api::twitter::input::snapshot)
                        .transpose()?;
                    Ok((file, snapshot))
                })
                .collect::<Result<Vec<_>, ApiError>>()
        })();
        let inputs = match inputs {
            Ok(v) => v,
            Err(error) => {
                let result = Submission::Rejected { error };
                if let Some(binding) = registry.requests.get_mut(&id) {
                    binding.result = result.clone();
                }
                return Ok(result);
            }
        };
        let validation_domain = domain.clone();
        let launched =
            self.queue
                .submit("Validate registered import input", move |task| async move {
                    let mut session = validation_domain
                        .database
                        .session(&task)
                        .await
                        .map_err(|e| ApiError::invalid(e.to_string()))?;
                    let kernel = validation_domain.kernel.clone();
                    session
                        .transaction_named("Check registered File eligibility", move |c| {
                            Box::pin(async move {
                                for (file, _) in &inputs {
                                    if let Some(file) = file {
                                        FileService::read_in(c, *file).await?;
                                        if kernel
                                            .attachment_in(c, file.component())
                                            .await?
                                            .is_some()
                                        {
                                            anyhow::bail!("Registered File is already attached");
                                        }
                                    }
                                }
                                Ok::<_, anyhow::Error>(inputs)
                            })
                        })
                        .await
                        .map_err(|e| ApiError::invalid(e.to_string()))
                });
        let handle = match launched {
            Ok(h) => h,
            Err(e) => {
                let result = Submission::Rejected {
                    error: ApiError::new(ErrorCode::LaunchRejected, e.to_string()),
                };
                if let Some(binding) = registry.requests.get_mut(&id) {
                    binding.result = result.clone();
                }
                return Ok(result);
            }
        };
        registry.active += 1;
        let state = self.clone();
        tokio::spawn(async move {
            let validated = handle
                .result()
                .await
                .map_err(|e| ApiError::new(ErrorCode::OperationFailed, e.to_string()))
                .and_then(|v| v);
            let outcome = match validated {
                Err(e) => Err(e),
                Ok(inputs) => {
                    let worker = state.clone();
                    let batch = id.clone();
                    state.public_claimed(
                        id.clone(),
                        arguments,
                        "Import registered content",
                        Some(inputs),
                        move |task| async move {
                            let ids = worker
                                .imports
                                .snapshots()
                                .into_iter()
                                .find(|b| b.id == batch)
                                .map(|b| b.items.into_iter().map(|i| i.id).collect::<Vec<_>>())
                                .unwrap_or_default();
                            for item in ids {
                                worker
                                    .imports
                                    .execute(&domain, &task, &batch, &item, Action::Original)
                                    .await;
                            }
                            worker.imports.finish_batch(&batch);
                            TaskOutcome::ImportBatch { batch_id: batch }
                        },
                    )
                }
            };
            let mut registry = state.lock();
            if let Err(error) = outcome {
                state.imports.release(&id, None, &id);
                if let Some(binding) = registry.requests.get_mut(&id) {
                    binding.result = Submission::Rejected { error };
                }
            }
            state.changed(&mut registry);
            state.complete(&mut registry);
        });
        Ok(Submission::AdmissionPending)
    }
}
