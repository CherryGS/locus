use crate::{capture::ValidationError, identity::BilibiliId};
use locus_core::api::CoreError;
use locus_file::api::FileError;
use locus_store::api::StoreError;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum BilibiliError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Core(#[from] CoreError),
    #[error(transparent)]
    File(#[from] FileError),
    #[error("Bilibili database operation failed: {0}")]
    Database(#[from] diesel::result::Error),
    #[error("invalid Bilibili submission: {0}")]
    Invalid(#[from] ValidationError),
    #[error("Bilibili record {0} is missing")]
    MissingRecord(BilibiliId),
    #[error("corrupt Bilibili record: {0}")]
    Corrupt(String),
    #[error("unsupported Bilibili payload version {0}")]
    PayloadVersion(u32),
    #[error("unsupported Bilibili schema version {0}")]
    SchemaVersion(i32),
    #[error("the intended Bilibili host/current File context is unavailable or different")]
    AssociationContext,
    #[error("Bilibili revision exhausted for {0}")]
    RevisionExhausted(BilibiliId),
}
