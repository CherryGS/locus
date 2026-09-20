use super::registry::{Binding, Entry, Shared};
use crate::api::{
    dto::*,
    error::{ApiError, ErrorCode},
    mapping,
};
use locus_file::api::FileId;
use locus_task::api::{TaskContext, TaskError, TaskHandle};
use std::{future::Future, sync::Arc};
use tokio::sync::oneshot;

impl Shared {
    pub fn import(self: &Arc<Self>, request: ImportRequest) -> Result<Receipt, ApiError> {
        let mut registry = self.lock();
        // Existing bindings survive the close/capacity gate and are never evicted.
        if let Some(binding) = registry.requests.get(&request.request_id) {
            if binding.arguments != request {
                return Err(ApiError::new(
                    ErrorCode::RequestConflict,
                    "Request ID is already bound to different import arguments",
                ));
            }
            return match &binding.result {
                Submission::Accepted { receipt } => Ok(receipt.clone()),
                Submission::Rejected { error } => Err(error.clone()),
            };
        }
        self.admit(&mut registry)?;
        if registry.requests.len() >= self.max_requests {
            return Err(ApiError::new(
                ErrorCode::Capacity,
                "Run request retention limit reached; earlier recovery state is retained",
            ));
        }
        let receipt = Receipt {
            run_id: self.run_id.clone(),
            request_id: request.request_id.clone(),
            task_id: uuid::Uuid::now_v7().to_string(),
        };
        let domain = self.domain.clone();
        let source = request.source_path.clone();
        // Claim and synchronous launch resolution share the drain boundary; no
        // domain operation or async wait runs while this lock is held.
        #[cfg(test)]
        let reject = std::mem::take(&mut registry.reject_next_launch);
        #[cfg(not(test))]
        let reject = false;
        let launched = if reject {
            Err(TaskError::NoRuntime)
        } else {
            self.queue.submit("Import File", move |task| async move {
                let mut session = match domain.database.session(&task).await {
                    Ok(session) => session,
                    Err(error) => {
                        return ImportOutcome::Failed {
                            diagnostic: Diagnostic {
                                kind: FailureKind::Database,
                                message: error.to_string(),
                            },
                            progress: None,
                        };
                    }
                };
                match domain
                    .files
                    .admit(&domain.kernel, &mut session, source)
                    .await
                {
                    Ok(file) => ImportOutcome::Imported {
                        file: mapping::metadata(file),
                    },
                    Err(error) => mapping::failure(error),
                }
            })
        };
        let handle = match launched {
            Ok(handle) => handle,
            Err(error) => {
                let error = ApiError::new(ErrorCode::LaunchRejected, error.to_string());
                registry.requests.insert(
                    request.request_id.clone(),
                    Binding {
                        arguments: request,
                        result: Submission::Rejected {
                            error: error.clone(),
                        },
                    },
                );
                return Err(error);
            }
        };
        registry.requests.insert(
            request.request_id.clone(),
            Binding {
                arguments: request,
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
                    request_id: receipt.request_id.clone(),
                    label: "Import File".into(),
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
        // The runtime owns this supervisor, independently of handler/observer loss.
        tokio::spawn(supervise(self.clone(), receipt.task_id.clone(), handle));
        Ok(receipt)
    }

    pub async fn read(self: &Arc<Self>, id: FileId) -> Result<FileMetadata, ApiError> {
        let domain = self.domain.clone();
        let receiver = self.direct("Read File metadata", move |task| async move {
            let mut session =
                domain.database.session(&task).await.map_err(|error| {
                    ApiError::new(ErrorCode::OperationFailed, error.to_string())
                })?;
            domain
                .files
                .read(&mut session, id)
                .await
                .map(mapping::metadata)
                .map_err(mapping::read_error)
        })?;
        receiver
            .await
            .map_err(|_| {
                ApiError::new(
                    ErrorCode::OperationFailed,
                    "Direct operation supervisor was lost",
                )
            })?
            .map_err(|error| ApiError::new(ErrorCode::OperationFailed, error.to_string()))?
    }

    pub(super) fn direct<T, F, Fut>(
        self: &Arc<Self>,
        label: &str,
        operation: F,
    ) -> Result<oneshot::Receiver<Result<T, TaskError>>, ApiError>
    where
        T: Send + 'static,
        F: FnOnce(TaskContext) -> Fut + Send + 'static,
        Fut: Future<Output = T> + Send + 'static,
    {
        let mut registry = self.lock();
        self.admit(&mut registry)?;
        let handle = self
            .queue
            .submit(label, operation)
            .map_err(|error| ApiError::new(ErrorCode::LaunchRejected, error.to_string()))?;
        registry.active += 1;
        let state = self.clone();
        let (sender, receiver) = oneshot::channel();
        tokio::spawn(async move {
            let result = handle.result().await;
            // Completion follows actual protected-worker lifetime, even if the
            // handler dropped its receiver while waiting for this direct result.
            state.complete(&mut state.lock());
            let _ = sender.send(result);
        });
        Ok(receiver)
    }
}

async fn supervise(state: Arc<Shared>, id: String, handle: TaskHandle<ImportOutcome>) {
    let mut changes = handle.subscribe();
    let result = handle.result();
    tokio::pin!(result);
    loop {
        tokio::select! {
            biased;
            outcome = &mut result => {
                state.finish(&id, outcome.unwrap_or_else(|error| mapping::executor(error.to_string())));
                return;
            }
            changed = changes.changed() => {
                if changed.is_ok() { state.progress(&id, changes.borrow_and_update().clone()); }
            }
        }
    }
}
