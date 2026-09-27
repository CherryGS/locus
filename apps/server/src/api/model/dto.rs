use crate::api::{
    core::dto::CoreFailure,
    error::{Diagnostic, DomainDiagnostic},
    media::dto::Applicability,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use utoipa::ToSchema;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum ModelFailure {
    Core { error: CoreFailure },
    File { diagnostic: Diagnostic },
    Store { diagnostic: Diagnostic },
    MissingRecord { component_id: String },
    Corrupt { message: String },
    ContextChanged,
    NewerAttempt,
    Attempt { failure: ModelAttemptFailure },
    Other { message: String },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ModelAttemptCode {
    MissingInput,
    FileAccess,
    UnsupportedInput,
    Structure,
    Worker,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ModelAttemptFailure {
    pub code: ModelAttemptCode,
    pub detail: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ModelTensor {
    pub name: String,
    pub shape: Vec<String>,
    pub storage_type: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ModelStorageSummary {
    pub tensor_count: String,
    pub element_count: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ModelInspection {
    pub format: String,
    pub coverage: String,
    pub tensors: Vec<ModelTensor>,
    pub tensor_count: String,
    pub element_count: String,
    pub storage_types: BTreeMap<String, ModelStorageSummary>,
    pub declarations: Option<BTreeMap<String, String>>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ModelRecord {
    pub component_id: String,
    pub revision: String,
    pub basis: Option<String>,
    pub facts: Option<ModelInspection>,
    pub last_failure: Option<ModelAttemptFailure>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ModelView {
    pub record: ModelRecord,
    pub host: Option<String>,
    pub applicability: Applicability,
    pub file_problem: Option<DomainDiagnostic>,
}
