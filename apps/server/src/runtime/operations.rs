use super::registry::Shared;
use crate::api::{
    dto::TaskOutcome,
    error::{ApiError, ErrorCode},
    mapping,
};
use locus_task::api::{TaskContext, TaskError, TaskHandle};
use std::{future::Future, sync::Arc};
use tokio::sync::oneshot;
impl Shared {
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
