use crate::{
    coordinator::{Coordinator, Request, Resource},
    error::TaskError,
    observation::{TaskSnapshot, TaskState},
    stage::{Lease, Stage},
};
use std::{
    future::Future,
    sync::{Arc, Mutex},
};
use tokio::sync::{Notify, watch};
use uuid::Uuid;

#[derive(Clone)]
pub struct TaskContext {
    pub(crate) inner: Arc<Execution>,
}

pub(crate) struct Execution {
    pub(crate) coordinator_id: Uuid,
    pub(crate) coordinator: Arc<Coordinator>,
    pub(crate) snapshots: watch::Sender<TaskSnapshot>,
    pub(crate) lifecycle: Mutex<Lifecycle>,
    pub(crate) idle: Notify,
}

#[derive(Default)]
pub(crate) struct Lifecycle {
    pub(crate) active: bool,
    pub(crate) closed: bool,
    pub(crate) continuation: bool,
}

impl TaskContext {
    pub fn accepts(&self, resource: &Resource) -> bool {
        self.inner.coordinator_id == resource.coordinator
    }

    pub fn progress(&self, completed: Option<u64>, total: Option<u64>, message: impl Into<String>) {
        let message = message.into();
        self.inner.snapshots.send_modify(|snapshot| {
            snapshot.completed = completed;
            snapshot.total = total;
            snapshot.message = Some(message);
        });
    }

    /// Borrowed stages support operations such as transactions. Owners MUST drop
    /// protected connections/work before this scope. Use run/spawn_blocking for
    /// work that can outlive an awaiter; a bare guard cannot supervise arbitrary
    /// independently spawned work.
    pub async fn enter(
        &self,
        label: impl Into<String>,
        resources: &[Resource],
    ) -> Result<Stage, TaskError> {
        let label = label.into();
        if resources.iter().any(|r| !self.accepts(r)) {
            return Err(TaskError::ForeignResource);
        }
        let id = Uuid::now_v7();
        let continuation = {
            let mut state = self
                .inner
                .lifecycle
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if state.closed {
                return Err(TaskError::Closed);
            }
            if state.active {
                return Err(TaskError::NestedStage);
            }
            state.active = true;
            state.continuation
        };
        let lease = Arc::new(Lease {
            request: id,
            context: self.clone(),
            finished: watch::channel(()).0,
        });
        self.inner.snapshots.send_modify(|snapshot| {
            snapshot.state = TaskState::Waiting;
            snapshot.stage = Some(label);
            snapshot.message = None;
            snapshot.completed = None;
            snapshot.total = None;
        });
        {
            let mut state = self.inner.coordinator.lock();
            state.requests.push_back(Request {
                id,
                keys: resources.iter().map(|r| r.key).collect(),
                continuation,
                granted: false,
            });
            state.admit();
        }
        self.inner.coordinator.changed.notify_waiters();
        loop {
            let notified = self.inner.coordinator.changed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self
                .inner
                .coordinator
                .lock()
                .requests
                .iter()
                .any(|r| r.id == id && r.granted)
            {
                break;
            }
            notified.await;
        }
        self.inner
            .snapshots
            .send_modify(|s| s.state = TaskState::Running);
        Ok(Stage { lease })
    }

    /// Supervise an owned asynchronous stage independently of its awaiter.
    /// Returns only after its workers release their stage leases, including when
    /// the operation panics. Returned values must not themselves retain a Stage.
    pub async fn run<T, F, Fut>(
        &self,
        label: impl Into<String>,
        resources: &[Resource],
        operation: F,
    ) -> Result<T, TaskError>
    where
        T: Send + 'static,
        F: FnOnce(Stage) -> Fut + Send + 'static,
        Fut: Future<Output = T> + Send + 'static,
    {
        let stage = self.enter(label, resources).await?;
        let mut finished = stage.lease.finished.subscribe();
        let result = stage
            .spawn(operation)
            .await
            .map_err(|e| TaskError::Worker(e.to_string()));
        drop(stage);
        // The operation's result can precede a detached worker's actual end.
        // Wait for this exact stage, not for a later task-wide idle observation.
        let _ = finished.changed().await;
        result
    }

    pub(crate) async fn close(&self) {
        loop {
            let notified = self.inner.idle.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            {
                let mut state = self
                    .inner
                    .lifecycle
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                state.closed = true;
                if !state.active {
                    return;
                }
            }
            notified.await;
        }
    }
}
