use crate::{context::TaskContext, observation::TaskState};
use std::{future::Future, sync::Arc};
use tokio::task::JoinHandle;

pub(crate) struct Lease {
    pub(crate) request: uuid::Uuid,
    pub(crate) context: TaskContext,
    // This sole sender closes only after the last lease has released its locks
    // and reset the task's stage state. Waiting on it does not retain a lease.
    pub(crate) finished: tokio::sync::watch::Sender<()>,
}

impl Drop for Lease {
    fn drop(&mut self) {
        // Release before announcing idle and before the supervisor publishes completion.
        self.context.inner.coordinator.release(self.request);
        let mut state = self
            .context
            .inner
            .lifecycle
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        state.continuation = true;
        self.context
            .inner
            .snapshots
            .send_modify(|s| s.state = TaskState::BetweenStages);
        state.active = false;
        drop(state);
        self.context.inner.idle.notify_waiters();
    }
}

/// Clones retain the admitted set. Worker helpers retain a separate lease even
/// if the supplied operation drops its own Stage or panics.
#[derive(Clone)]
pub struct Stage {
    pub(crate) lease: Arc<Lease>,
}

impl Stage {
    pub fn progress(&self, completed: Option<u64>, total: Option<u64>, message: impl Into<String>) {
        self.lease.context.progress(completed, total, message);
    }

    pub fn spawn<T, F, Fut>(&self, operation: F) -> JoinHandle<T>
    where
        T: Send + 'static,
        F: FnOnce(Stage) -> Fut + Send + 'static,
        Fut: Future<Output = T> + Send + 'static,
    {
        let guard = self.clone();
        tokio::spawn(async move {
            let result = operation(guard.clone()).await;
            drop(guard);
            result
        })
    }

    pub fn spawn_blocking<T, F>(&self, operation: F) -> JoinHandle<T>
    where
        T: Send + 'static,
        F: FnOnce(Stage) -> T + Send + 'static,
    {
        let guard = self.clone();
        tokio::task::spawn_blocking(move || {
            let result = operation(guard.clone());
            drop(guard);
            result
        })
    }
}
