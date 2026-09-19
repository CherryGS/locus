use super::prepared::{AdmissionFailure, CopyProgress, PreparedFile};
use crate::{error::FileError, identity::FileId, service::FileService};
use locus_task::api::{Stage, TaskContext};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::Path,
};

impl FileService {
    /// Copy on the caller's Tokio blocking pool using bounded memory. Dropping
    /// this future may leave its worker copying; the worker NEVER admits a row.
    /// No path is deleted on failure, cancellation, token drop or rollback.
    pub async fn prepare(
        &self,
        source: impl AsRef<Path>,
    ) -> Result<PreparedFile, AdmissionFailure> {
        self.prepare_with_task(source.as_ref(), None).await
    }

    /// Copy with task progress and a lease retained by the actual blocking worker.
    pub async fn prepare_task(
        &self,
        task: &TaskContext,
        source: impl AsRef<Path>,
    ) -> Result<PreparedFile, AdmissionFailure> {
        self.prepare_with_task(source.as_ref(), Some(task)).await
    }

    async fn prepare_with_task(
        &self,
        source: &Path,
        task: Option<&TaskContext>,
    ) -> Result<PreparedFile, AdmissionFailure> {
        let source = source.to_path_buf();
        self.prepare_work(task, move |storage, progress, stage| {
            storage.prepare_blocking_progress(&source, progress, stage.as_ref())
        })
        .await
    }

    // One admission/worker boundary for real file input and controlled reader tests.
    // Preparation tokens still come only from the checked copy/flush implementation.
    pub(super) async fn prepare_work<F>(
        &self,
        task: Option<&TaskContext>,
        operation: F,
    ) -> Result<PreparedFile, AdmissionFailure>
    where
        F: FnOnce(Self, CopyProgress, Option<Stage>) -> Result<PreparedFile, AdmissionFailure>
            + Send
            + 'static,
    {
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
        let stage = match task {
            Some(task) => {
                Some(
                    task.enter("File copy", &[])
                        .await
                        .map_err(|source| AdmissionFailure {
                            progress: Box::new(progress.clone()),
                            source: FileError::Task(source),
                        })?,
                )
            }
            None => None,
        };
        let worker = match &stage {
            Some(stage) => {
                stage.spawn_blocking(move |stage| operation(storage, worker_progress, Some(stage)))
            }
            None => tokio::task::spawn_blocking(move || operation(storage, worker_progress, None)),
        };
        worker.await.map_err(|error| AdmissionFailure {
            // A worker panic can occur after creating/writing the destination.
            progress: Box::new(CopyProgress {
                managed_bytes_may_exist: true,
                ..progress
            }),
            source: FileError::Worker(error.to_string()),
        })?
    }

    #[cfg(test)]
    pub(super) fn prepare_blocking(
        &self,
        source: &Path,
        progress: CopyProgress,
    ) -> Result<PreparedFile, AdmissionFailure> {
        self.prepare_blocking_progress(source, progress, None)
    }

    fn prepare_blocking_progress(
        &self,
        source: &Path,
        progress: CopyProgress,
        stage: Option<&Stage>,
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
        let total = file.metadata().ok().map(|m| m.len());
        self.copy_reader_progress(file, progress, stage, total)
    }

    // The generic reader is a small deterministic test seam for mid-copy failures;
    // production always supplies the regular file checked above.
    #[cfg(test)]
    pub(super) fn copy_reader(
        &self,
        source: impl Read,
        progress: CopyProgress,
    ) -> Result<PreparedFile, AdmissionFailure> {
        self.copy_reader_progress(source, progress, None, None)
    }

    pub(super) fn copy_reader_progress(
        &self,
        mut source: impl Read,
        mut progress: CopyProgress,
        stage: Option<&Stage>,
        total: Option<u64>,
    ) -> Result<PreparedFile, AdmissionFailure> {
        if let Some(stage) = stage {
            stage.progress(Some(0), total, "Copying managed bytes");
        }
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
                if let Some(stage) = stage {
                    stage.progress(Some(progress.bytes_written), total, "Copying managed bytes");
                }
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
}
