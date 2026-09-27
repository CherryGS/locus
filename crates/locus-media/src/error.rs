use crate::identity::MediaId;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FailureCode {
    MissingInput,
    FileAccess,
    UnsupportedInput,
    Decode,
    Limit,
    Timeout,
    ToolUnavailable,
    ToolFailure,
    MalformedOutput,
    NoFrame,
    Worker,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Error)]
#[serde(deny_unknown_fields)]
#[error("{code:?}: {detail}")]
pub struct AttemptFailure {
    pub code: FailureCode,
    pub detail: String,
}
impl AttemptFailure {
    pub(crate) fn new(code: FailureCode, detail: impl ToString) -> Self {
        Self {
            code,
            detail: detail.to_string().chars().take(4096).collect(),
        }
    }
}
#[derive(Debug, Error)]
pub enum MediaError {
    #[error("original Media host/File context has changed")]
    ContextChanged,
    #[error("a newer Media interpretation changed the expected revision")]
    NewerAttempt,
    #[error(transparent)]
    Task(#[from] locus_task::api::TaskError),
    #[error(transparent)]
    Store(#[from] locus_store::api::StoreError),
    #[error(transparent)]
    Core(#[from] locus_core::api::CoreError),
    #[error(transparent)]
    File(#[from] locus_file::api::FileError),
    #[error(transparent)]
    Database(#[from] diesel::result::Error),
    #[error(transparent)]
    Identity(#[from] locus_core::api::IdentityError),
    #[error("Media record is missing: {0:?}")]
    MissingRecord(MediaId),
    #[error("invalid Media record: {0}")]
    Corrupt(String),
    #[error("Media configuration: {0}")]
    Configuration(String),
    #[error("cache: {0}")]
    Cache(String),
    #[error("preview access: {0}")]
    PreviewAccess(std::io::Error),
    #[error(transparent)]
    Attempt(#[from] AttemptFailure),
}
