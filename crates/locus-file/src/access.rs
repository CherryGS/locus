use crate::{FileError, FileId, FileRecord, FileStorage};
use locus_store::Session;
use std::{
    fs::File,
    io::{self, Read, Seek, SeekFrom},
};

/// Identified blocking reader. Use from blocking work for large reads. Opening
/// does not promise that later reads succeed; standard io::Error is propagated
/// unchanged and the identity stays available after any reader error.
#[derive(Debug)]
pub struct FileInput<R = File> {
    id: FileId,
    reader: R,
}
impl<R> FileInput<R> {
    pub fn id(&self) -> FileId {
        self.id
    }
}
impl<R: Read> Read for FileInput<R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        self.reader.read(buffer)
    }
}
impl<R: Seek> Seek for FileInput<R> {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        self.reader.seek(position)
    }
}
impl FileStorage {
    /// Validated identified local input for adapters requiring a filesystem path.
    /// The open handle is retained; this is not protection from hostile path replacement.
    pub async fn local_path(
        &self,
        session: &mut Session,
        id: FileId,
    ) -> Result<LocalFile, FileError> {
        let record = self.lookup(session, id).await?;
        let storage = self.clone();
        tokio::task::spawn_blocking(move || {
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
        .map_err(|error| FileError::Worker(error.to_string()))?
    }
    pub async fn open(&self, session: &mut Session, id: FileId) -> Result<FileInput, FileError> {
        let record = self.lookup(session, id).await?;
        let storage = self.clone();
        tokio::task::spawn_blocking(move || storage.open_with(&record, |path| File::open(path)))
            .await
            .map_err(|error| FileError::Worker(error.to_string()))?
    }
    fn open_with<R>(
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

#[derive(Debug)]
pub struct LocalFile {
    id: FileId,
    path: std::path::PathBuf,
    handle: File,
}
impl LocalFile {
    pub fn id(&self) -> FileId {
        self.id
    }
    pub fn path(&self) -> &std::path::Path {
        &self.path
    }
    pub fn handle(&self) -> &File {
        &self.handle
    }
    pub fn into_reader(self) -> FileInput {
        FileInput {
            id: self.id,
            reader: self.handle,
        }
    }
}

#[cfg(test)]
mod tests;
