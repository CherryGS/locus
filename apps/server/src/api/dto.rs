use super::{
    error::{Diagnostic, DomainDiagnostic},
    file::dto::{CopyProgress, FileMetadata},
    media::dto::{Interpretation, MediaTarget, PreviewMetadata},
    preferences::dto::{EntityViewPreference, SavedViewPreference},
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

// These envelopes combine domain outcomes and run-local delivery state. Their
// owner is the server, rather than the generic task foundation or one domain.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RequestIdentity {
    pub request_id: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct Receipt {
    pub run_id: String,
    pub request_id: String,
    pub task_id: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum TaskOutcome {
    ImportBatch {
        batch_id: String,
    },
    ImportRecovery {
        batch_id: String,
        item_id: String,
    },
    Interpreted {
        result: Interpretation,
    },
    Preview {
        preview: PreviewMetadata,
    },
    MediaFailed {
        diagnostic: DomainDiagnostic,
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
    AdmissionPending,
    Accepted { receipt: Receipt },
    Rejected { error: super::error::ApiError },
    DirectPending,
    DirectComplete { outcome: MutationOutcome },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum MutationOutcome {
    SettingsSaved {
        saved: super::settings::dto::SavedSettings,
    },
    SettingsExisting {
        current: super::settings::dto::SettingsObservation,
    },
    SettingsConflict {
        current: super::settings::dto::SettingsObservation,
    },
    EntityCreated {
        entity_id: String,
    },
    MediaCreated {
        target: MediaTarget,
        kind_id: String,
    },
    Attached,
    AlreadyAttached,
    Detached {
        removed: bool,
    },
    ViewPreferenceSaved {
        preference: SavedViewPreference,
    },
    ViewPreferenceConflict {
        current: EntityViewPreference,
    },
    ViewPreferenceMissing {
        entity_id: String,
    },
    Failed {
        diagnostic: DomainDiagnostic,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AdmissionState {
    Open,
    Draining,
    Drained,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Availability {
    Normal,
    Restricted { message: String },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct ServerStatus {
    pub availability: Availability,
    pub run_id: String,
    pub admission: AdmissionState,
    /// Includes private direct-response work until actual queue completion.
    pub active_operations: String,
}
/// Compatibility name for callers of the original File-only API.
pub type ImportOutcome = TaskOutcome;
