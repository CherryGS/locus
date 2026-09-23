use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct ExternalBootstrap {
    pub run_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct ExternalRuntime {
    pub captured: Option<crate::api::settings::dto::SavedSettings>,
    pub active_address: Option<String>,
    pub override_address: Option<String>,
    pub problem: Option<String>,
}
#[derive(Clone, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum TokenObservation {
    Current {
        run_id: String,
        context_id: String,
        revision: String,
        token: String,
    },
    Unavailable {
        run_id: String,
        message: String,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ResetToken {
    pub request_id: String,
    pub expected_revision: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct UploadMetadata {
    pub request_id: String,
    pub byte_count: String,
    pub filename: Option<String>,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UploadAction {
    Retry,
    Recopy,
    Confirm,
}
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RecoverUpload {
    pub request_id: String,
    pub upload_id: String,
    pub action: UploadAction,
}
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
pub struct UploadObservation {
    pub upload_id: String,
    pub filename: Option<String>,
    pub byte_count: String,
    pub receiving: bool,
    pub active_request_id: Option<String>,
    pub confirmed_file_id: Option<String>,
    pub candidate_file_id: Option<String>,
    pub uncertain: bool,
    pub problem: Option<String>,
    pub actions: Vec<UploadAction>,
    pub copied_bytes: Option<String>,
    pub copy_complete: bool,
    pub managed_bytes_may_exist: bool,
}
