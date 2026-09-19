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

#[cfg(test)]
mod tests;
