use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// An intentional import submission. Reuse its ID only with identical arguments.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ImportRequest {
    /// Canonical hyphenated UUID, scoped to the supplied backend run.
    pub request_id: String,
    /// Absolute local source path. Copying preserves the source.
    pub source_path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct Receipt {
    pub run_id: String,
    pub request_id: String,
    pub task_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct FileMetadata {
    pub file_id: String,
    pub kind_id: String,
    pub relative_path: String,
    /// Exact nonnegative decimal integer, never a JavaScript floating-point number.
    pub byte_count: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct CopyProgress {
    pub file_id: String,
    pub relative_path: String,
    pub bytes_written: String,
    pub managed_bytes_may_exist: bool,
    pub copy_complete: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FailureKind {
    InputMissing,
    ManagedBytesMissing,
    AccessDenied,
    NotRegularFile,
    Io,
    CommitOutcomeUnknown,
    Database,
    Domain,
    Executor,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct Diagnostic {
    pub kind: FailureKind,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum TaskOutcome {
    Interpreted {
        result: super::media_dto::Interpretation,
    },
    Preview {
        preview: super::media_dto::PreviewMetadata,
    },
    MediaFailed {
        diagnostic: super::media_dto::DomainDiagnostic,
    },
    Imported {
        file: FileMetadata,
    },
    Failed {
        diagnostic: Diagnostic,
        progress: Option<CopyProgress>,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum OutcomeResponse {
    Pending,
    Complete { outcome: TaskOutcome },
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Submission {
    Accepted {
        receipt: Receipt,
    },
    Rejected {
        error: super::error::ApiError,
    },
    DirectPending,
    DirectComplete {
        outcome: super::media_dto::MutationOutcome,
    },
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

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AdmissionState {
    Open,
    Draining,
    Drained,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct ServerStatus {
    pub run_id: String,
    pub admission: AdmissionState,
    /// Includes private direct-response work until actual queue completion.
    pub active_operations: String,
}

/// Compatibility name for callers of the original File-only API.
pub type ImportOutcome = TaskOutcome;
