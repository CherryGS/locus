use crate::{
    context::{Execution, Lifecycle, TaskContext},
    coordinator::{Coordinator, Resource},
    error::TaskError,
    identity::TaskId,
    observation::{TaskHandle, TaskSnapshot, TaskState},
};
use std::{
    future::Future,
    sync::{Arc, Mutex},
};
use tokio::sync::{Notify, oneshot, watch};
use uuid::Uuid;

#[derive(Clone)]
pub struct TaskQueue {
    id: Uuid,
    coordinator: Arc<Coordinator>,
}

impl Default for TaskQueue {
    fn default() -> Self {
        Self::new()
    }
}

impl TaskQueue {
    pub fn new() -> Self {
        Self {
            id: Uuid::now_v7(),
            coordinator: Arc::default(),
        }
    }

    pub fn resource(&self) -> Resource {
        Resource {
            coordinator: self.id,
            key: Uuid::now_v7(),
        }
    }

    /// Resource owners namespace their canonical identities. Equal names within
    /// this queue denote one actual resource; use resource() for unique instances.
    pub fn named_resource(&self, identity: impl Into<String>) -> Resource {
        let identity = identity.into();
        self.coordinator
            .lock()
            .named
            .entry(identity)
            .or_insert_with(|| self.resource())
            .clone()
    }

    pub fn submit<T, F, Fut>(
        &self,
        label: impl Into<String>,
        operation: F,
    ) -> Result<TaskHandle<T>, TaskError>
    where
        T: Send + 'static,
        F: FnOnce(TaskContext) -> Fut + Send + 'static,
        Fut: Future<Output = T> + Send + 'static,
    {
        let runtime = tokio::runtime::Handle::try_current().map_err(|_| TaskError::NoRuntime)?;
        let (snapshots, receiver) = watch::channel(TaskSnapshot {
            id: TaskId(Uuid::now_v7()),
            label: label.into(),
            state: TaskState::Submitted,
            stage: None,
            message: None,
            completed: None,
            total: None,
        });
        let context = TaskContext {
            inner: Arc::new(Execution {
                coordinator_id: self.id,
                coordinator: self.coordinator.clone(),
                snapshots,
                lifecycle: Mutex::new(Lifecycle::default()),
                idle: Notify::new(),
            }),
        };
        let (sender, result) = oneshot::channel();
        runtime.spawn(async move {
            let body_context = context.clone();
            let result = tokio::spawn(async move {
                body_context
                    .inner
                    .snapshots
                    .send_modify(|s| s.state = TaskState::BetweenStages);
                operation(body_context).await
            })
            .await
            .map_err(|e| TaskError::Worker(e.to_string()));
            context.close().await;
            context.inner.snapshots.send_modify(|s| {
                s.state = if result.is_ok() {
                    TaskState::Completed
                } else {
                    TaskState::Failed
                }
            });
            let _ = sender.send(result);
        });
        Ok(TaskHandle {
            snapshots: receiver,
            result,
        })
    }
}
