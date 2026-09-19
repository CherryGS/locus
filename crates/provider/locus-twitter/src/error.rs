use crate::{capture::ValidationError, identity::TwitterId};
use locus_core::api::CoreError;
use locus_file::api::FileError;
use locus_store::api::StoreError;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TwitterError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Core(#[from] CoreError),
    #[error(transparent)]
    File(#[from] FileError),
    #[error("Twitter database operation failed: {0}")]
    Database(#[from] diesel::result::Error),
    #[error("invalid Twitter submission: {0}")]
    Invalid(#[from] ValidationError),
    #[error("Twitter record {0} is missing")]
    MissingRecord(TwitterId),
    #[error("corrupt Twitter record: {0}")]
    Corrupt(String),
    #[error("unsupported Twitter payload version {0}")]
    PayloadVersion(u32),
    #[error("unsupported Twitter schema version {0}")]
    SchemaVersion(i32),
    #[error("the intended Twitter host/current File context is unavailable or different")]
    AssociationContext,
    #[error("Twitter revision exhausted for {0}")]
    RevisionExhausted(TwitterId),
}
