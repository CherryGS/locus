use super::prepared::CopyProgress;
use crate::{error::FileError, identity::FileId, service::FileService};
use locus_store::api::Session;
use std::io;
use std::{fs::File, io::Read};

struct FailAfterChunk {
    file: File,
    remaining: usize,
}
impl Read for FailAfterChunk {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if self.remaining == 0 {
            return Err(io::Error::other("deterministic mid-copy failure"));
        }
        let limit = buffer.len().min(self.remaining);
        let count = self.file.read(&mut buffer[..limit])?;
        self.remaining -= count;
        Ok(count)
    }
}
fn progress(storage: &FileService, id: FileId) -> CopyProgress {
    CopyProgress {
        id,
        root: storage.root.clone(),
        relative_path: id.relative_path(),
        bytes_written: 0,
        managed_bytes_may_exist: false,
        copy_complete: false,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn partial_copy_is_retained_and_collision_never_overwrites() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("original");
    let bytes = vec![7_u8; 100_000];
    std::fs::write(&source, &bytes).unwrap();
    let storage = FileService::new(directory.path().join("library"))
        .await
        .unwrap();
    let id = FileId::fresh();
    let error = storage
        .copy_reader(
            FailAfterChunk {
                file: File::open(&source).unwrap(),
                remaining: 70_000,
            },
            progress(&storage, id),
        )
        .unwrap_err();
    assert_eq!(error.progress.id, id);
    assert_eq!(error.progress.bytes_written, 70_000);
    assert!(!error.progress.copy_complete);
    assert!(error.progress.managed_bytes_may_exist);
    let object = storage.root.join(&error.progress.relative_path);
    assert_eq!(std::fs::read(&object).unwrap(), &bytes[..70_000]);
    let collision = storage
        .prepare_blocking(&source, progress(&storage, id))
        .unwrap_err();
    assert!(
        matches!(collision.source, FileError::Io { source, .. } if source.kind() == io::ErrorKind::AlreadyExists)
    );
    assert_eq!(std::fs::read(&object).unwrap(), &bytes[..70_000]);
    assert_eq!(std::fs::read(&source).unwrap(), bytes);
    let mut session = Session::memory().await.unwrap();
    storage.initialize(&mut session).await.unwrap();
    assert!(
        matches!(storage.read(&mut session, id).await, Err(FileError::MissingRecord(actual)) if actual == id)
    );
}

struct PausedReader {
    file: File,
    started: Option<tokio::sync::oneshot::Sender<()>>,
    release: std::sync::mpsc::Receiver<()>,
}
impl Read for PausedReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if let Some(started) = self.started.take() {
            started.send(()).unwrap();
            self.release.recv().unwrap();
        }
        self.file.read(buffer)
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn canceled_awaiter_does_not_stop_blocking_copy_or_autonomously_admit() {
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("original");
        std::fs::write(&source, b"copy continues").unwrap();
        let storage = FileService::new(directory.path().join("library")).await.unwrap();
        let mut session = Session::memory().await.unwrap();
        storage.initialize(&mut session).await.unwrap();
        let id = FileId::fresh();
        let initial = progress(&storage, id);
        let reader = File::open(&source).unwrap();
        let worker = storage.clone();
        let (started, ready) = tokio::sync::oneshot::channel();
        let (release, released) = std::sync::mpsc::channel();
        let (finished, done) = tokio::sync::oneshot::channel();
        let awaiter = tokio::spawn(async move {
            tokio::task::spawn_blocking(move || {
                let result = worker.copy_reader(PausedReader { file: reader, started: Some(started), release: released }, initial);
                finished.send(result).unwrap();
            }).await.unwrap();
        });
        ready.await.unwrap();
        awaiter.abort();
        assert!(awaiter.await.unwrap_err().is_cancelled());
        release.send(()).unwrap();
        let prepared = done.await.unwrap().unwrap();
        assert_eq!(prepared.id(), id);
        assert!(prepared.progress().copy_complete);
        assert_eq!(std::fs::read(storage.root.join(&prepared.progress().relative_path)).unwrap(), std::fs::read(source).unwrap());
        assert!(matches!(storage.read(&mut session, id).await, Err(FileError::MissingRecord(actual)) if actual == id));
    }).await.unwrap();
}
