use crate::api::media::dto::{MediaKind, PreviewMetadata};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct BatchImportRequest {
    pub request_id: String,
    pub source_paths: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RegisteredImportRequest {
    pub request_id: String,
    pub items: Vec<RegisteredImportItem>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RegisteredImportItem {
    pub file_id: Option<String>,
    pub twitter: Option<crate::api::twitter::dto::TwitterSnapshot>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ImportAction {
    Retry,
    Recopy,
    Confirm,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ImportRecoveryRequest {
    pub request_id: String,
    pub batch_id: String,
    pub item_id: String,
    pub action: ImportAction,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ImportStepState {
    NotRequested,
    Pending,
    Running,
    Success,
    NoMatch,
    Failed,
    Uncertain,
    Conflict,
    Skipped,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ImportStep {
    pub state: ImportStepState,
    pub reason: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ImportKindResult {
    pub kind: MediaKind,
    pub component_id: Option<String>,
    pub recognition: ImportStep,
    pub establishment: ImportStep,
    pub interpretation: ImportStep,
    pub preview: ImportStep,
    pub output: Option<PreviewMetadata>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ImportResult {
    pub observation_problem: Option<String>,
    pub copy: ImportStep,
    pub registration: ImportStep,
    pub file_attachment: ImportStep,
    pub twitter: ImportStep,
    pub association: ImportStep,
    pub twitter_id: Option<String>,
    pub confirmed_file_id: Option<String>,
    pub confirmed_entity_id: Option<String>,
    pub overall: Option<ImportOverall>,
    pub base: ImportStep,
    pub entity_id: Option<String>,
    pub file_id: Option<String>,
    pub copied_bytes: Option<String>,
    pub managed_bytes_may_exist: bool,
    pub copy_complete: bool,
    pub kinds: Vec<ImportKindResult>,
    pub complete: bool,
    pub effect_revision: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ImportOverall {
    Success,
    Failure,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ImportAttemptAction {
    Original,
    Retry,
    Recopy,
    Confirm,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ImportAttempt {
    pub request_id: String,
    pub action: ImportAttemptAction,
    pub ended: bool,
    pub result: ImportResult,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ImportItem {
    pub item_id: String,
    pub source_path: String,
    pub supplied: bool,
    pub requested_file: bool,
    pub requested_twitter: bool,
    pub active_request_id: Option<String>,
    pub current: ImportResult,
    pub attempts: Vec<ImportAttempt>,
    pub actions: Vec<ImportAction>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ImportBatch {
    pub batch_id: String,
    pub original_ended: bool,
    pub original_overall: Option<ImportOverall>,
    pub items: Vec<ImportItem>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ImportSnapshot {
    pub admission: crate::api::dto::AdmissionState,
    pub run_id: String,
    pub batches: Vec<ImportBatch>,
}
