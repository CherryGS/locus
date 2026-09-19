use crate::error::TaskError;
use crate::identity::TaskId;
use tokio::sync::{oneshot, watch};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskState {
    Submitted,
    Waiting,
    Running,
    /// The ordinary task body is executing without an admitted stage.
    BetweenStages,
    /// The typed operation value is available; this does not interpret domain success.
    Completed,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskSnapshot {
    pub id: TaskId,
    pub label: String,
    pub state: TaskState,
    pub stage: Option<String>,
    pub message: Option<String>,
    pub completed: Option<u64>,
    pub total: Option<u64>,
}

/// Dropping observation never aborts the accepted operation. Results are retained
/// in this handle until consumed/dropped, not in a persistent queue history.
pub struct TaskHandle<T> {
    pub(crate) snapshots: watch::Receiver<TaskSnapshot>,
    pub(crate) result: oneshot::Receiver<Result<T, TaskError>>,
}

impl<T> TaskHandle<T> {
    pub fn snapshot(&self) -> TaskSnapshot {
        self.snapshots.borrow().clone()
    }

    pub fn subscribe(&self) -> watch::Receiver<TaskSnapshot> {
        self.snapshots.clone()
    }

    pub async fn result(self) -> Result<T, TaskError> {
        self.result
            .await
            .map_err(|e| TaskError::Worker(e.to_string()))?
    }
}
