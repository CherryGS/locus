use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PublicTaskState {
    Submitted,
    Waiting,
    Running,
    BetweenStages,
    Terminal,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct PublicTask {
    pub task_id: String,
    pub request_id: String,
    pub label: String,
    pub state: PublicTaskState,
    pub stage: Option<String>,
    pub message: Option<String>,
    /// Missing values mean unknown progress, not zero.
    pub completed: Option<String>,
    pub total: Option<String>,
    pub outcome_available: bool,
}
/// Complete replacement projection. Reconnect replaces the prior baseline.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct TaskSnapshot {
    pub run_id: String,
    /// Exact monotonically increasing decimal revision within this run.
    pub revision: String,
    pub tasks: Vec<PublicTask>,
}
