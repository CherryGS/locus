use super::types::{FileInput, LocalFile};
use crate::{error::FileError, identity::FileId, record::FileRecord, service::FileService};
use locus_store::api::Session;
use std::{fs::File, io};

impl FileService {
    /// Validated identified local input for adapters requiring a filesystem path.
    /// The open handle is retained; this is not protection from hostile path replacement.
    pub async fn local_path(
        &self,
        session: &mut Session,
        id: FileId,
    ) -> Result<LocalFile, FileError> {
        let record = self.read(session, id).await?;
        let storage = self.clone();
        self.access_work(session.task_context(), move || {
            let path = storage.record_path(&record)?;
            let handle = File::open(&path).map_err(|error| FileError::Access {
                id,
                cause: error.into(),
            })?;
            if !handle
                .metadata()
                .map_err(|error| FileError::Access {
                    id,
                    cause: error.into(),
                })?
                .is_file()
            {
                return Err(FileError::NotRegularFile);
            }
            Ok(LocalFile { id, path, handle })
        })
        .await
    }
    pub async fn open(&self, session: &mut Session, id: FileId) -> Result<FileInput, FileError> {
        let record = self.read(session, id).await?;
        let storage = self.clone();
        self.access_work(session.task_context(), move || {
            storage.open_with(&record, |path| File::open(path))
        })
        .await
    }
    async fn access_work<T, F>(
        &self,
        task: Option<&locus_task::api::TaskContext>,
        operation: F,
    ) -> Result<T, FileError>
    where
        T: Send + 'static,
        F: FnOnce() -> Result<T, FileError> + Send + 'static,
    {
        let stage = match task {
            Some(task) => Some(task.enter("File input access", &[]).await?),
            None => None,
        };
        let worker = match &stage {
            Some(stage) => stage.spawn_blocking(move |_| operation()),
            None => tokio::task::spawn_blocking(operation),
        };
        worker
            .await
            .map_err(|error| FileError::Worker(error.to_string()))?
    }

    pub(super) fn open_with<R>(
        &self,
        record: &FileRecord,
        opener: impl FnOnce(&std::path::Path) -> io::Result<R>,
    ) -> Result<FileInput<R>, FileError> {
        let path = self.record_path(record)?;
        let reader = opener(&path).map_err(|error| FileError::Access {
            id: record.id,
            cause: error.into(),
        })?;
        Ok(FileInput {
            id: record.id,
            reader,
        })
    }
}
