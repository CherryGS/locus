use super::registry::Shared;
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
        let domain = self.domain.clone();
        let source = request.source_path.clone();
        self.public(
            request.request_id.clone(),
            super::submissions::Arguments::Import(request),
            "Import File",
            move |task| async move {
                let mut session = match domain.database.session(&task).await {
                    Ok(session) => session,
                    Err(error) => {
                        return TaskOutcome::Failed {
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
                    Ok(file) => TaskOutcome::Imported {
                        file: mapping::metadata(file),
                    },
                    Err(error) => mapping::failure(error),
                }
            },
        )
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

pub(super) async fn supervise(state: Arc<Shared>, id: String, handle: TaskHandle<TaskOutcome>) {
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
