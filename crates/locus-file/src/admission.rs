use crate::{FILE_KIND, FileError, FileId, FileRecord, FileStorage};
use diesel::{
    sql_query,
    sql_types::{BigInt, Binary, Text},
};
use diesel_async::RunQueryDsl;
use locus_core::Kernel;
use locus_store::{Context, Session};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
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
    progress: CopyProgress,
}
impl PreparedFile {
    pub fn progress(&self) -> &CopyProgress {
        &self.progress
    }
    pub fn id(&self) -> FileId {
        self.progress.id
    }
    fn record(&self) -> FileRecord {
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

impl FileStorage {
    /// Copy on the caller's Tokio blocking pool using bounded memory. Dropping
    /// this future may leave its worker copying; the worker NEVER admits a row.
    /// No path is deleted on failure, cancellation, token drop or rollback.
    pub async fn prepare(
        &self,
        source: impl AsRef<Path>,
    ) -> Result<PreparedFile, AdmissionFailure> {
        let source = source.as_ref().to_path_buf();
        let storage = self.clone();
        let progress = CopyProgress {
            id: FileId::fresh(),
            root: self.root.clone(),
            relative_path: String::new(),
            bytes_written: 0,
            managed_bytes_may_exist: false,
            copy_complete: false,
        };
        let progress = CopyProgress {
            relative_path: progress.id.relative_path(),
            ..progress
        };
        let worker_progress = progress.clone();
        tokio::task::spawn_blocking(move || storage.prepare_blocking(&source, worker_progress))
            .await
            .map_err(|error| AdmissionFailure {
                // A worker panic can occur after creating/writing the destination.
                progress: Box::new(CopyProgress {
                    managed_bytes_may_exist: true,
                    ..progress
                }),
                source: FileError::Worker(error.to_string()),
            })?
    }

    fn prepare_blocking(
        &self,
        source: &Path,
        progress: CopyProgress,
    ) -> Result<PreparedFile, AdmissionFailure> {
        let open = || -> Result<File, FileError> {
            let file = File::open(source).map_err(|source_error| FileError::Io {
                path: source.to_path_buf(),
                source: source_error,
            })?;
            if !file
                .metadata()
                .map_err(|source_error| FileError::Io {
                    path: source.to_path_buf(),
                    source: source_error,
                })?
                .is_file()
            {
                return Err(FileError::NotRegularFile);
            }
            Ok(file)
        };
        let file = open().map_err(|source| AdmissionFailure {
            progress: Box::new(progress.clone()),
            source,
        })?;
        self.copy_reader(file, progress)
    }

    // The generic reader is a small deterministic test seam for mid-copy failures;
    // production always supplies the regular file checked above.
    fn copy_reader(
        &self,
        mut source: impl Read,
        mut progress: CopyProgress,
    ) -> Result<PreparedFile, AdmissionFailure> {
        let copy = || -> Result<(), FileError> {
            let destination = self.checked_path(progress.id)?;
            let parent = destination
                .parent()
                .ok_or_else(|| FileError::InvalidLocation {
                    id: progress.id,
                    path: progress.relative_path.clone(),
                })?;
            std::fs::create_dir_all(parent).map_err(|source| FileError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
            // Check after creating parents too, before opening any output.
            self.checked_path(progress.id)?;
            progress.managed_bytes_may_exist = true;
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&destination)
                .map_err(|source| FileError::Io {
                    path: destination.clone(),
                    source,
                })?;
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                let length = source.read(&mut buffer).map_err(FileError::CopyRead)?;
                if length == 0 {
                    break;
                }
                output
                    .write_all(&buffer[..length])
                    .map_err(|source| FileError::Io {
                        path: destination.clone(),
                        source,
                    })?;
                progress.bytes_written = progress
                    .bytes_written
                    .checked_add(length as u64)
                    .filter(|size| *size <= i64::MAX as u64)
                    .ok_or(FileError::ByteCountOverflow)?;
            }
            output.flush().map_err(|source| FileError::Io {
                path: destination,
                source,
            })?;
            progress.copy_complete = true;
            Ok(())
        };
        let mut copy = copy;
        copy().map_err(|source| AdmissionFailure {
            progress: Box::new(progress.clone()),
            source,
        })?;
        Ok(PreparedFile { progress })
    }

    /// Standalone convenience: successful copy followed by committed registration.
    /// Errors retain copy progress even when database commit completion is unknown.
    pub async fn admit(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        source: impl AsRef<Path>,
    ) -> Result<FileRecord, AdmissionFailure> {
        let prepared = self.prepare(source).await?;
        self.register(kernel, session, &prepared)
            .await
            .map_err(|source| AdmissionFailure {
                progress: Box::new(prepared.progress),
                source,
            })
    }

    /// Register a completed copy in a standalone committed unit. The caller keeps
    /// the prepared value on all errors, including StoreError::CommitOutcomeUnknown.
    pub async fn register(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        prepared: &PreparedFile,
    ) -> Result<FileRecord, FileError> {
        let storage = self.clone();
        let kernel = kernel.clone();
        let prepared = prepared.clone();
        session
            .transaction(move |context| {
                Box::pin(async move { storage.register_in(&kernel, context, &prepared).await })
            })
            .await
    }

    /// Provisional participant: both payload and core identity are protected by a
    /// savepoint even if the transaction owner catches this operation's error.
    /// The caller retains the prepared value for rollback/uncertain-commit inspection.
    pub async fn register_in(
        &self,
        kernel: &Kernel,
        context: &mut Context,
        prepared: &PreparedFile,
    ) -> Result<FileRecord, FileError> {
        if self.root != prepared.progress.root {
            return Err(FileError::WrongRoot);
        }
        let record = prepared.record();
        let storage = self.clone();
        let check_record = record.clone();
        tokio::task::spawn_blocking(move || -> Result<(), FileError> {
            let path = storage.record_path(&check_record)?;
            let file = File::open(path).map_err(|error| FileError::Access {
                id: check_record.id,
                cause: error.into(),
            })?;
            let metadata = file.metadata().map_err(|error| FileError::Access {
                id: check_record.id,
                cause: error.into(),
            })?;
            if !metadata.is_file() || metadata.len() != check_record.byte_count {
                return Err(FileError::PreparedCopyChanged(check_record.id));
            }
            Ok(())
        })
        .await
        .map_err(|error| FileError::Worker(error.to_string()))??;
        let kernel = kernel.clone();
        context
            .savepoint(move |context| {
                Box::pin(async move {
                    sql_query(
                        "INSERT INTO locus_files (id, relative_path, byte_count) VALUES (?, ?, ?)",
                    )
                    .bind::<Binary, _>(record.id.as_bytes().as_slice())
                    .bind::<Text, _>(&record.relative_path)
                    .bind::<BigInt, _>(
                        i64::try_from(record.byte_count)
                            .map_err(|_| FileError::ByteCountOverflow)?,
                    )
                    .execute(context.connection())
                    .await?;
                    kernel
                        .admit_component_in(context, FILE_KIND, record.id.component())
                        .await?;
                    Ok(record)
                })
            })
            .await
    }
}

#[cfg(test)]
mod tests;
