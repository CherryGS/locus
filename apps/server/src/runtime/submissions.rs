use super::{
    operations::supervise,
    registry::{Binding, Entry, Shared},
};
use crate::api::{
    core::dto::Membership,
    dto::*,
    error::{ApiError, DomainDiagnostic, ErrorCode},
    file::dto::ImportRequest,
    media::dto::{MediaKind, MediaTarget},
    task::dto::{AccessContext, PublicTask, PublicTaskState, TaskOperation},
};
use locus_task::api::{TaskContext, TaskError};
use std::{future::Future, sync::Arc};

pub(crate) struct Admission {
    pub context: AccessContext,
    pub authorization: Option<super::external::Authorization>,
    pub batch: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Arguments {
    Upload(crate::api::external::dto::UploadMetadata),
    RecoverUpload(crate::api::external::dto::RecoverUpload),
    ResetToken {
        expected_revision: String,
    },
    Settings {
        group: uuid::Uuid,
        change: crate::api::settings::dto::SettingsChange,
    },
    ImportBatch(crate::api::imports::dto::BatchImportRequest),
    RegisteredImport(crate::api::imports::dto::RegisteredImportRequest),
    RecoverImport(crate::api::imports::dto::ImportRecoveryRequest),
    Import(ImportRequest),
    CreateEntity,
    CreateMedia(MediaKind),
    Attach(Membership),
    Detach(Membership),
    Interpret(MediaTarget),
    Preview {
        target: MediaTarget,
        edge: u32,
    },
    UpdateViewPreference {
        entity: locus_core::api::EntityId,
        view: crate::preferences::identity::ViewDefinitionId,
        revision: Option<crate::preferences::identity::SavedRevision>,
    },
}
impl Shared {
    pub(super) fn public<F, Fut>(
        self: &Arc<Self>,
        id: String,
        arguments: Arguments,
        label: &str,
        operation: F,
    ) -> Result<Receipt, ApiError>
    where
        F: FnOnce(TaskContext) -> Fut + Send + 'static,
        Fut: Future<Output = TaskOutcome> + Send + 'static,
    {
        self.public_claimed(
            Admission {
                context: AccessContext::Desktop,
                authorization: None,
                batch: None,
            },
            id,
            arguments,
            label,
            None,
            operation,
        )
    }
    pub(crate) fn public_claimed<F, Fut>(
        self: &Arc<Self>,
        admission: Admission,
        id: String,
        arguments: Arguments,
        label: &str,
        inputs: Option<Vec<crate::imports::RegisteredInput>>,
        operation: F,
    ) -> Result<Receipt, ApiError>
    where
        F: FnOnce(TaskContext) -> Fut + Send + 'static,
        Fut: Future<Output = TaskOutcome> + Send + 'static,
    {
        let Admission {
            context,
            authorization,
            batch,
        } = admission;
        let mut registry = self.lock();
        if let Some(binding) = registry.requests.get(&(context, id.clone())) {
            check(binding, &arguments)?;
            if !((inputs.is_some() || matches!(arguments, Arguments::Upload(_)))
                && matches!(binding.result, Submission::AdmissionPending))
            {
                return match &binding.result {
                    Submission::Accepted { receipt } => Ok(receipt.clone()),
                    Submission::Rejected { error } => Err(error.clone()),
                    _ => Err(conflict()),
                };
            }
        }
        if let Some(basis) = &authorization {
            self.external_current(basis)?;
        }
        self.admit(&mut registry)?;
        if let Some(inputs) = inputs {
            self.imports
                .reserve_registered(batch.as_deref().unwrap_or(&id), &id, context, inputs);
        }
        let descriptor = match &arguments {
            Arguments::Upload(r) => TaskOperation::Upload {
                upload_id: r.request_id.clone(),
                filename: r.filename.clone(),
                byte_count: r.byte_count.clone(),
            },
            Arguments::RecoverUpload(r) => TaskOperation::UploadRecovery {
                upload_id: r.upload_id.clone(),
            },
            Arguments::ImportBatch(r) => TaskOperation::ImportBatch {
                batch_id: batch.clone().unwrap_or_else(|| r.request_id.clone()),
                item_count: r.source_paths.len(),
            },
            Arguments::RegisteredImport(r) => TaskOperation::ImportBatch {
                batch_id: batch.clone().unwrap_or_else(|| r.request_id.clone()),
                item_count: r.items.len(),
            },
            Arguments::RecoverImport(r) => TaskOperation::ImportRecovery {
                batch_id: r.batch_id.clone(),
                item_id: r.item_id.clone(),
            },
            Arguments::Import(r) => TaskOperation::FileImport {
                source_path: r.source_path.clone(),
            },
            Arguments::Interpret(target) => TaskOperation::Interpretation {
                target: target.clone(),
            },
            Arguments::Preview { target, edge } => TaskOperation::Preview {
                target: target.clone(),
                edge: *edge,
            },
            _ => return Err(conflict()),
        };
        match &arguments {
            Arguments::RecoverUpload(r) => self.uploads.reserve_recovery(r)?,
            Arguments::ImportBatch(r) => self.imports.reserve_batch(
                batch.as_deref().unwrap_or(&r.request_id),
                &r.request_id,
                context,
                &r.source_paths,
            ),
            Arguments::RecoverImport(r) => self
                .imports
                .reserve_recovery(
                    &r.batch_id,
                    &r.item_id,
                    &r.request_id,
                    crate::api::imports::mapping::action(r.action),
                )
                .map_err(|e| ApiError::new(ErrorCode::RequestConflict, e))?,
            _ => (),
        }
        #[cfg(test)]
        let reject = std::mem::take(&mut registry.reject_next_launch);
        #[cfg(not(test))]
        let reject = false;
        let launched = if reject {
            Err(TaskError::NoRuntime)
        } else {
            self.queue.submit(label, operation)
        };
        let handle = match launched {
            Ok(handle) => handle,
            Err(error) => {
                match &arguments {
                    Arguments::RecoverUpload(r) => self.uploads.release(r),
                    Arguments::ImportBatch(r) => {
                        self.imports
                            .release(batch.as_deref().unwrap_or(&r.request_id), None, &id)
                    }
                    Arguments::RegisteredImport(r) => {
                        self.imports
                            .release(batch.as_deref().unwrap_or(&r.request_id), None, &id)
                    }
                    Arguments::RecoverImport(r) => {
                        self.imports.release(&r.batch_id, Some(&r.item_id), &id)
                    }
                    _ => (),
                }
                let error = ApiError::new(ErrorCode::LaunchRejected, error.to_string());
                registry.requests.insert(
                    (context, id),
                    Binding {
                        arguments,
                        result: Submission::Rejected {
                            error: error.clone(),
                        },
                    },
                );
                return Err(error);
            }
        };
        let receipt = Receipt {
            run_id: self.run_id.clone(),
            request_id: id.clone(),
            task_id: uuid::Uuid::now_v7().to_string(),
        };
        registry.requests.insert(
            (context, id.clone()),
            Binding {
                arguments,
                result: Submission::Accepted {
                    receipt: receipt.clone(),
                },
            },
        );
        registry.tasks.insert(
            receipt.task_id.clone(),
            Entry {
                projection: PublicTask {
                    access_context: context,
                    task_id: receipt.task_id.clone(),
                    request_id: id,
                    label: label.into(),
                    operation: descriptor,
                    state: PublicTaskState::Submitted,
                    stage: None,
                    message: None,
                    completed: None,
                    total: None,
                    outcome_available: false,
                },
                outcome: None,
            },
        );
        registry.active += 1;
        self.changed(&mut registry);
        tokio::spawn(supervise(self.clone(), receipt.task_id.clone(), handle));
        Ok(receipt)
    }

    /// Launch and recovery are synchronous under the admission gate. The detached
    /// supervisor retains the committed outcome even if every waiting handler ends.
    pub(super) async fn mutation<F, Fut>(
        self: &Arc<Self>,
        id: String,
        arguments: Arguments,
        label: &str,
        operation: F,
    ) -> Result<MutationOutcome, ApiError>
    where
        F: FnOnce(TaskContext) -> Fut + Send + 'static,
        Fut: Future<Output = MutationOutcome> + Send + 'static,
    {
        let mut changes = self.changes.subscribe();
        {
            let mut registry = self.lock();
            if let Some(binding) = registry.requests.get(&(AccessContext::Desktop, id.clone())) {
                check(binding, &arguments)?;
            } else {
                self.admit(&mut registry)?;
                #[cfg(test)]
                let reject = std::mem::take(&mut registry.reject_next_launch);
                #[cfg(not(test))]
                let reject = false;
                let launched = if reject {
                    Err(TaskError::NoRuntime)
                } else {
                    self.queue.submit(label, operation)
                };
                match launched {
                    Err(error) => {
                        let error = ApiError::new(ErrorCode::LaunchRejected, error.to_string());
                        registry.requests.insert(
                            (AccessContext::Desktop, id.clone()),
                            Binding {
                                arguments,
                                result: Submission::Rejected { error },
                            },
                        );
                    }
                    Ok(handle) => {
                        let reset_basis = match &arguments {
                            Arguments::ResetToken { expected_revision } => {
                                Some(expected_revision.clone())
                            }
                            _ => None,
                        };
                        registry.requests.insert(
                            (AccessContext::Desktop, id.clone()),
                            Binding {
                                arguments,
                                result: Submission::DirectPending,
                            },
                        );
                        registry.active += 1;
                        let state = self.clone();
                        let id = id.clone();
                        tokio::spawn(async move {
                            let result = handle.result().await;
                            let reset_failed = result.is_err();
                            let outcome = result.unwrap_or_else(|error| MutationOutcome::Failed {
                                diagnostic: DomainDiagnostic::Executor {
                                    message: error.to_string(),
                                },
                            });
                            let mut registry = state.lock();
                            let lost_effective_state = reset_failed
                                && reset_basis.is_some_and(|basis| {
                                    state
                                        .access
                                        .lock()
                                        .current
                                        .as_ref()
                                        .is_some_and(|c| c.revision == basis)
                                });
                            if lost_effective_state {
                                state.access.establish(Err(anyhow::anyhow!("Credential execution ended without effective completion evidence")));
                            }
                            if let Some(binding) = registry
                                .requests
                                .get_mut(&(AccessContext::Desktop, id.clone()))
                            {
                                binding.result = Submission::DirectComplete { outcome };
                            }
                            state.changed(&mut registry);
                            state.complete(&mut registry);
                        });
                    }
                }
            }
        }
        loop {
            match self.submission(&id)? {
                Submission::DirectComplete { outcome } => return Ok(outcome),
                Submission::Rejected { error } => return Err(error),
                Submission::DirectPending => (),
                _ => return Err(conflict()),
            }
            changes.changed().await.map_err(|_| {
                ApiError::new(ErrorCode::OperationFailed, "Operation supervisor lost")
            })?;
        }
    }

    pub(super) async fn query<T, F, Fut>(
        self: &Arc<Self>,
        label: &str,
        operation: F,
    ) -> Result<T, ApiError>
    where
        T: Send + 'static,
        F: FnOnce(TaskContext) -> Fut + Send + 'static,
        Fut: Future<Output = Result<T, ApiError>> + Send + 'static,
    {
        self.direct(label, operation)?
            .await
            .map_err(|_| ApiError::new(ErrorCode::OperationFailed, "Operation supervisor lost"))?
            .map_err(|e| ApiError::new(ErrorCode::OperationFailed, e.to_string()))?
    }
}
pub(super) fn conflict() -> ApiError {
    ApiError::new(
        ErrorCode::RequestConflict,
        "Request ID is already bound to another operation or argument set",
    )
}
pub(crate) fn check(binding: &Binding, arguments: &Arguments) -> Result<(), ApiError> {
    if &binding.arguments == arguments {
        Ok(())
    } else {
        Err(conflict())
    }
}
