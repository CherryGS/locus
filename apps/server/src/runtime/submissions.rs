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
    task::dto::{PublicTask, PublicTaskState},
};
use locus_task::api::{TaskContext, TaskError};
use std::{future::Future, sync::Arc};

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Arguments {
    ImportBatch(crate::api::imports::dto::BatchImportRequest),
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
        let mut registry = self.lock();
        if let Some(binding) = registry.requests.get(&id) {
            check(binding, &arguments)?;
            return match &binding.result {
                Submission::Accepted { receipt } => Ok(receipt.clone()),
                Submission::Rejected { error } => Err(error.clone()),
                _ => Err(conflict()),
            };
        }
        self.admit(&mut registry)?;
        match &arguments {
            Arguments::ImportBatch(r) => self.imports.reserve_batch(&r.request_id, &r.source_paths),
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
                    Arguments::ImportBatch(r) => self.imports.release(&r.request_id, None, &id),
                    Arguments::RecoverImport(r) => {
                        self.imports.release(&r.batch_id, Some(&r.item_id), &id)
                    }
                    _ => (),
                }
                let error = ApiError::new(ErrorCode::LaunchRejected, error.to_string());
                registry.requests.insert(
                    id,
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
            id.clone(),
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
                    task_id: receipt.task_id.clone(),
                    request_id: id,
                    label: label.into(),
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
            if let Some(binding) = registry.requests.get(&id) {
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
                            id.clone(),
                            Binding {
                                arguments,
                                result: Submission::Rejected { error },
                            },
                        );
                    }
                    Ok(handle) => {
                        registry.requests.insert(
                            id.clone(),
                            Binding {
                                arguments,
                                result: Submission::DirectPending,
                            },
                        );
                        registry.active += 1;
                        let state = self.clone();
                        let id = id.clone();
                        tokio::spawn(async move {
                            let outcome = handle.result().await.unwrap_or_else(|error| {
                                MutationOutcome::Failed {
                                    diagnostic: DomainDiagnostic::Executor {
                                        message: error.to_string(),
                                    },
                                }
                            });
                            let mut registry = state.lock();
                            if let Some(binding) = registry.requests.get_mut(&id) {
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
fn conflict() -> ApiError {
    ApiError::new(
        ErrorCode::RequestConflict,
        "Request ID is already bound to another operation or argument set",
    )
}
fn check(binding: &Binding, arguments: &Arguments) -> Result<(), ApiError> {
    if &binding.arguments == arguments {
        Ok(())
    } else {
        Err(conflict())
    }
}
