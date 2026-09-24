use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum AccessContext {
    Desktop,
    External,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PublicTaskState {
    Submitted,
    Waiting,
    Running,
    BetweenStages,
    Terminal,
}
/// Accepted business scope, independent of display labels and execution stages.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TaskOperation {
    Civitai {
        entity_id: String,
        operation_id: String,
    },
    Upload {
        upload_id: String,
        filename: Option<String>,
        byte_count: String,
    },
    UploadRecovery {
        upload_id: String,
    },
    ImportBatch {
        batch_id: String,
        item_count: usize,
    },
    ImportRecovery {
        batch_id: String,
        item_id: String,
    },
    FileImport {
        source_path: String,
    },
    Interpretation {
        target: crate::api::media::dto::MediaTarget,
    },
    Preview {
        target: crate::api::media::dto::MediaTarget,
        edge: u32,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct PublicTask {
    pub access_context: AccessContext,
    pub task_id: String,
    pub request_id: String,
    pub label: String,
    pub operation: TaskOperation,
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
