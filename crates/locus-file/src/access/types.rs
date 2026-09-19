use crate::identity::FileId;
use std::{
    fs::File,
    io::{self, Read, Seek, SeekFrom},
};

/// Identified blocking reader. Use from blocking work for large reads. Opening
/// does not promise that later reads succeed; standard io::Error is propagated
/// unchanged and the identity stays available after any reader error.
#[derive(Debug)]
pub struct FileInput<R = File> {
    pub(super) id: FileId,
    pub(super) reader: R,
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

#[derive(Debug)]
pub struct LocalFile {
    pub(super) id: FileId,
    pub(super) path: std::path::PathBuf,
    pub(super) handle: File,
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
