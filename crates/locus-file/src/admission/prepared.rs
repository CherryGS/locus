use crate::{error::FileError, identity::FileId, record::FileRecord};
use std::path::PathBuf;
use thiserror::Error;

/// Known copy progress, never evidence of accepted database state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CopyProgress {
    pub id: FileId,
    pub root: PathBuf,
    pub relative_path: String,
    /// Confirmed bytes written before the last successful write. A failing write
    /// can have written additional bytes; this is not a partial-file size promise.
    pub bytes_written: u64,
    pub managed_bytes_may_exist: bool,
    pub copy_complete: bool,
}

/// Only completed copy/flush can create this capability. Retain it across a
/// transaction so rollback or uncertain commit never loses the object identity.
#[derive(Debug, Clone)]
pub struct PreparedFile {
    pub(super) progress: CopyProgress,
}
impl PreparedFile {
    pub fn progress(&self) -> &CopyProgress {
        &self.progress
    }
    pub fn id(&self) -> FileId {
        self.progress.id
    }
    pub(super) fn record(&self) -> FileRecord {
        FileRecord {
            id: self.id(),
            relative_path: self.progress.relative_path.clone(),
            byte_count: self.progress.bytes_written,
        }
    }
}

#[derive(Debug, Error)]
#[error("File admission failed for {id}: {source}", id = .progress.id)]
pub struct AdmissionFailure {
    pub progress: Box<CopyProgress>,
    #[source]
    pub source: FileError,
}
