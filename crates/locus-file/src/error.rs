use crate::identity::FileId;
use locus_core::api::{CoreError, IdentityError};
use locus_store::api::StoreError;
use std::{io, path::PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AccessCause {
    #[error("managed bytes are missing: {0}")]
    MissingBytes(#[source] io::Error),
    #[error("managed bytes access was denied: {0}")]
    Denied(#[source] io::Error),
    #[error("managed byte I/O failed: {0}")]
    Io(#[source] io::Error),
}
impl From<io::Error> for AccessCause {
    fn from(error: io::Error) -> Self {
        match error.kind() {
            io::ErrorKind::NotFound => Self::MissingBytes(error),
            io::ErrorKind::PermissionDenied => Self::Denied(error),
            _ => Self::Io(error),
        }
    }
}

#[derive(Debug, Error)]
pub enum FileError {
    #[error(transparent)]
    Task(#[from] locus_task::api::TaskError),
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Core(#[from] CoreError),
    #[error(transparent)]
    Database(#[from] diesel::result::Error),
    #[error(transparent)]
    Identity(#[from] IdentityError),
    #[error("File record {0} is missing")]
    MissingRecord(FileId),
    #[error("cannot access File {id}: {cause}")]
    Access {
        id: FileId,
        #[source]
        cause: AccessCause,
    },
    #[error("invalid controlled location for File {id}: {path}")]
    InvalidLocation { id: FileId, path: String },
    #[error("prepared managed copy {0} is no longer the expected regular file")]
    PreparedCopyChanged(FileId),
    #[error("prepared File belongs to another configured root")]
    WrongRoot,
    #[error("I/O at {path:?}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("reading copy input failed: {0}")]
    CopyRead(#[source] io::Error),
    #[error("input must be a regular file")]
    NotRegularFile,
    #[error("copied byte count exceeds SQLite's nonnegative integer range")]
    ByteCountOverflow,
    #[error("blocking I/O worker did not complete: {0}")]
    Worker(String),
}
