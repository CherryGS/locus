use crate::api::{
    dto::*,
    error::{ApiError, ErrorCode},
    task::dto::*,
};
use locus_task::api::{TaskQueue, TaskSnapshot as QueueSnapshot, TaskState};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{Mutex, MutexGuard},
};
use tokio::sync::watch;

/// Explicit host/test configuration. Credentials are never logged or persisted.
pub struct ServerConfig {
    pub credential: String,
    pub library_root: PathBuf,
    /// Explicit trusted build output, never a library or request-selected path.
    pub renderer_root: Option<PathBuf>,
}
impl ServerConfig {
    pub fn new(credential: String, library_root: PathBuf) -> Self {
        Self {
            credential,
            library_root,
            renderer_root: None,
        }
    }
}
pub(crate) struct Binding {
    pub arguments: super::submissions::Arguments,
    pub result: Submission,
}
pub(crate) struct Entry {
    pub projection: PublicTask,
    pub outcome: Option<TaskOutcome>,
}
pub(crate) struct Registry {
    pub open: bool,
    pub active: usize,
    pub revision: u64,
    pub requests: BTreeMap<String, Binding>,
    pub tasks: BTreeMap<String, Entry>,
    pub previews: BTreeMap<String, std::sync::Arc<locus_media::api::Preview>>,
    #[cfg(test)]
    pub reject_next_launch: bool,
}
pub(crate) struct Shared {
    pub credential: String,
    pub origin: String,
    pub run_id: String,
    pub queue: TaskQueue,
    pub domain: super::composition::Domain,
    pub registry: Mutex<Registry>,
    pub changes: watch::Sender<u64>,
    pub drained: watch::Sender<bool>,
}
impl Shared {
    pub fn lock(&self) -> MutexGuard<'_, Registry> {
        self.registry
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }
    pub fn status(&self) -> ServerStatus {
        self.status_in(&self.lock())
    }
    fn status_in(&self, registry: &Registry) -> ServerStatus {
        ServerStatus {
            run_id: self.run_id.clone(),
            admission: if registry.open {
                AdmissionState::Open
            } else if registry.active == 0 {
                AdmissionState::Drained
            } else {
                AdmissionState::Draining
            },
            active_operations: registry.active.to_string(),
        }
    }
    pub fn close(&self) -> ServerStatus {
        let mut registry = self.lock();
        registry.open = false;
        if registry.active == 0 {
            self.drained.send_replace(true);
        }
        self.status_in(&registry)
    }
    pub async fn wait_drained(&self) {
        let mut receiver = self.drained.subscribe();
        let _ = receiver.wait_for(|done| *done).await;
    }
    pub fn admit(&self, registry: &mut Registry) -> Result<(), ApiError> {
        if !registry.open {
            return Err(ApiError::new(
                ErrorCode::AdmissionClosed,
                "New work is closed; existing submissions remain recoverable during drain",
            ));
        }
        Ok(())
    }
    pub fn complete(&self, registry: &mut Registry) {
        registry.active -= 1;
        if !registry.open && registry.active == 0 {
            self.drained.send_replace(true);
        }
    }
    pub fn changed(&self, registry: &mut Registry) {
        // Progress changes one entry only. HTTP/SSE consumers serialize coalesced
        // replacement snapshots, rather than every File copy chunk.
        registry.revision += 1;
        self.changes.send_replace(registry.revision);
    }
    pub fn snapshot(&self) -> TaskSnapshot {
        let registry = self.lock();
        TaskSnapshot {
            run_id: self.run_id.clone(),
            revision: registry.revision.to_string(),
            tasks: registry
                .tasks
                .values()
                .map(|entry| entry.projection.clone())
                .collect(),
        }
    }
    pub fn task(&self, id: &str) -> Result<PublicTask, ApiError> {
        self.lock()
            .tasks
            .get(id)
            .map(|entry| entry.projection.clone())
            .ok_or_else(unknown_task)
    }
    pub fn outcome(&self, id: &str) -> Result<OutcomeResponse, ApiError> {
        let registry = self.lock();
        let entry = registry.tasks.get(id).ok_or_else(unknown_task)?;
        Ok(match &entry.outcome {
            Some(outcome) => OutcomeResponse::Complete {
                outcome: outcome.clone(),
            },
            None => OutcomeResponse::Pending,
        })
    }
    pub fn submission(&self, id: &str) -> Result<Submission, ApiError> {
        self.lock().requests.get(id).map(|binding| binding.result.clone()).ok_or_else(|| ApiError::new(ErrorCode::UnknownRequest, "Unknown request in this run; this does not establish absence of durable effects"))
    }
    pub fn progress(&self, id: &str, snapshot: QueueSnapshot) {
        // Raw terminal notification precedes result receipt. finish() alone may
        // publish terminal state, after retaining the typed operation outcome.
        let state = match snapshot.state {
            TaskState::Submitted => PublicTaskState::Submitted,
            TaskState::Waiting => PublicTaskState::Waiting,
            TaskState::Running => PublicTaskState::Running,
            TaskState::BetweenStages => PublicTaskState::BetweenStages,
            TaskState::Completed | TaskState::Failed => return,
        };
        let mut registry = self.lock();
        if let Some(entry) = registry.tasks.get_mut(id) {
            entry.projection.state = state;
            entry.projection.stage = snapshot.stage;
            entry.projection.message = snapshot.message;
            entry.projection.completed = snapshot.completed.map(|n| n.to_string());
            entry.projection.total = snapshot.total.map(|n| n.to_string());
            self.changed(&mut registry);
        }
    }
    pub fn finish(&self, id: &str, outcome: TaskOutcome) {
        let mut registry = self.lock();
        if let Some(entry) = registry.tasks.get_mut(id) {
            entry.outcome = Some(outcome);
            entry.projection.state = PublicTaskState::Terminal;
            entry.projection.outcome_available = true;
            self.changed(&mut registry);
        }
        self.complete(&mut registry);
    }
}
fn unknown_task() -> ApiError {
    ApiError::new(
        ErrorCode::UnknownTask,
        "Unknown task in this run; this does not establish absence of durable effects",
    )
}
pub(crate) fn initial_registry() -> Registry {
    Registry {
        open: true,
        active: 0,
        revision: 0,
        requests: BTreeMap::new(),
        tasks: BTreeMap::new(),
        previews: BTreeMap::new(),
        #[cfg(test)]
        reject_next_launch: false,
    }
}
