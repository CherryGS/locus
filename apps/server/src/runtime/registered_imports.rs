use super::{
    registry::{Binding, Shared},
    submissions::{Arguments, check},
};
use crate::api::task::dto::AccessContext;
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
        self.registered_import_in(AccessContext::Desktop, None, request)
    }
    pub fn registered_import_in(
        self: &Arc<Self>,
        context: AccessContext,
        authorization: Option<super::external::Authorization>,
        request: RegisteredImportRequest,
    ) -> Result<Submission, ApiError> {
        let domain = self.business()?.clone();
        let arguments = Arguments::RegisteredImport(request.clone());
        let mut registry = self.lock();
        if let Some(binding) = registry
            .requests
            .get(&(context, request.request_id.clone()))
        {
            check(binding, &arguments)?;
            return Ok(binding.result.clone());
        }
        if let Some(basis) = &authorization {
            self.external_current(basis)?;
        }
        self.admit(&mut registry)?;
        let id = request.request_id.clone();
        registry.requests.insert(
            (context, id.clone()),
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
                    if item.file_id.is_none() && item.twitter.is_none() && item.bilibili.is_none() {
                        return Err(ApiError::invalid(
                            "An item requires a registered File or Source snapshot",
                        ));
                    }
                    if item.cover_file_id.is_some() && item.bilibili.is_none() {
                        return Err(ApiError::invalid(
                            "A cover request requires Bilibili Source",
                        ));
                    }
                    let file = item.file_id.map(parse_file).transpose()?;
                    let cover = item.cover_file_id.map(parse_file).transpose()?;
                    let bilibili = item
                        .bilibili
                        .map(crate::api::bilibili::input::snapshot)
                        .transpose()?;
                    let snapshot = item
                        .twitter
                        .map(crate::api::twitter::input::snapshot)
                        .transpose()?;
                    Ok((file, snapshot, bilibili, cover))
                })
                .collect::<Result<Vec<_>, ApiError>>()
        })();
        let inputs = match inputs {
            Ok(v) => v,
            Err(error) => {
                let result = Submission::Rejected { error };
                if let Some(binding) = registry.requests.get_mut(&(context, id.clone())) {
                    binding.result = result.clone();
                }
                return Ok(result);
            }
        };
        let validation_domain = domain.clone();
        let access_context = authorization.as_ref().map(|a| a.context_id.clone());
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
                                for (file, _, _, cover) in &inputs {
                                    for file in [file, cover].into_iter().flatten() {
                                        if let Some(context) = &access_context {
                                            anyhow::ensure!(
                                                crate::access::persistence::eligible(
                                                    c, context, *file
                                                )
                                                .await?,
                                                "File is not eligible in this external context"
                                            );
                                        }
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
                if let Some(binding) = registry.requests.get_mut(&(context, id.clone())) {
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
                    let batch = uuid::Uuid::now_v7().to_string();
                    state.public_claimed(
                        crate::runtime::submissions::Admission {
                            context,
                            authorization,
                            batch: Some(batch.clone()),
                        },
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
            if let Err(error) = outcome
                && let Some(binding) = registry.requests.get_mut(&(context, id.clone()))
            {
                binding.result = Submission::Rejected { error };
            }
            state.changed(&mut registry);
            state.complete(&mut registry);
        });
        Ok(Submission::AdmissionPending)
    }
}

fn parse_file(v: String) -> Result<FileId, ApiError> {
    let parsed = uuid::Uuid::parse_str(&v).map_err(|e| ApiError::invalid(e.to_string()))?;
    if parsed.to_string() != v {
        return Err(ApiError::invalid("File identity must be canonical"));
    }
    FileId::from_bytes(parsed.as_bytes()).map_err(|e| ApiError::invalid(e.to_string()))
}
