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
#[serde(tag = "status", rename_all = "snake_case")]
pub enum CurrentInput {
    File { file_id: String },
    MissingEntity { entity_id: String },
    MissingSlot { entity_id: String },
}
