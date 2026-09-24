use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CivitaiFile {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub raw_json: String,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CivitaiImage {
    pub id: Option<String>,
    pub kind: Option<String>,
    pub raw_json: String,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CivitaiVersion {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub base_model: Option<String>,
    pub files: Vec<CivitaiFile>,
    pub images: Vec<CivitaiImage>,
    pub raw_json: String,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CivitaiModel {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub kind: String,
    pub tags: Vec<String>,
    pub versions: Vec<CivitaiVersion>,
    pub raw_json: String,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CivitaiRecord {
    pub component_id: String,
    pub revision: String,
    pub observation: String,
    pub file_id: String,
    pub matched_version: String,
    pub matched_file: String,
    pub blake3: String,
    pub model: CivitaiModel,
    pub lookup_json: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CivitaiInput {
    Current,
    Changed,
    Missing,
    Unmounted,
    Failed,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CivitaiView {
    pub record: CivitaiRecord,
    pub host: Option<String>,
    pub input: CivitaiInput,
    pub problem: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CivitaiSource {
    pub component_id: String,
    pub entity_id: String,
    pub observation: String,
    pub revision: String,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CivitaiCorrespondence {
    pub source: CivitaiSource,
    pub version: String,
    pub file: String,
    pub basis: String,
    pub input: CivitaiInput,
    pub problem: Option<String>,
    pub blake3: String,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CivitaiDirectoryEntry {
    pub id: String,
    pub in_origin: bool,
    pub sources: Vec<CivitaiSource>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CivitaiPage {
    pub origin: CivitaiView,
    pub versions: Vec<CivitaiDirectoryEntry>,
    pub correspondences: Vec<CivitaiCorrespondence>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CivitaiBinding {
    pub occurrence: usize,
    pub remote_id: Option<String>,
    pub entity_id: String,
    pub file_id: String,
    pub acquired_observation: String,
    pub content_type: String,
    pub complete: bool,
    pub media: Vec<super::super::media::dto::MediaTarget>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CivitaiManagedExample {
    pub source: CivitaiSource,
    pub binding: CivitaiBinding,
    pub applicable: bool,
    pub problem: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CivitaiVersionView {
    pub model: String,
    pub source: CivitaiSource,
    pub in_origin: bool,
    pub version: CivitaiVersion,
    pub correspondences: Vec<CivitaiCorrespondence>,
    pub examples: Vec<CivitaiManagedExample>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CivitaiState {
    Pending,
    Running,
    Complete,
    Failed,
    Conflict,
    Uncertain,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CivitaiMetadataState {
    Pending,
    Accepted,
    NoMatch,
    Failed,
    Conflict,
    Uncertain,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CivitaiExampleOutcome {
    pub preparations: Vec<crate::api::file::dto::CopyProgress>,
    pub occurrence: usize,
    pub remote_id: Option<String>,
    pub state: CivitaiState,
    pub binding: Option<CivitaiBinding>,
    pub reused: bool,
    pub prepared_file: Option<String>,
    pub problem: Option<String>,
    pub file_registered: bool,
    pub target_candidate: Option<String>,
    pub target_confirmed: bool,
    pub registration_uncertain: bool,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CivitaiOutcome {
    pub first_only: bool,
    pub requested_examples: Option<usize>,
    pub entity_id: String,
    pub file_id: String,
    pub state: CivitaiState,
    pub metadata: CivitaiMetadataState,
    pub component_id: Option<String>,
    pub observation: Option<String>,
    pub problem: Option<String>,
    pub effect_revision: String,
    pub examples: Vec<CivitaiExampleOutcome>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CivitaiRequest {
    pub request_id: String,
    pub entity_id: String,
    pub file_id: String,
    pub first_only: bool,
    pub continuation: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CivitaiOperation {
    pub unconfirmed_effects: bool,
    pub last_request_id: String,
    pub operation_id: String,
    pub active_request_id: Option<String>,
    pub outcome: CivitaiOutcome,
    pub observation_problem: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CivitaiOperations {
    pub run_id: String,
    pub operations: Vec<CivitaiOperation>,
}
