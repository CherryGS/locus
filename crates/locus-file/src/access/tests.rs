use crate::{
    error::{AccessCause, FileError},
    owner::FileOwner,
    service::FileService,
};
use locus_core::api::Kernel;
use locus_store::api::Session;
use std::sync::Arc;
use std::{
    fs::File,
    io::{self, Read},
};

struct FailingReader;
impl Read for FailingReader {
    fn read(&mut self, _buffer: &mut [u8]) -> io::Result<usize> {
        Err(io::Error::other("late reader failure"))
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn denied_open_and_later_read_failure_keep_identity_and_accepted_state() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("original");
    std::fs::write(&source, b"retained bytes").unwrap();
    let storage = FileService::new(directory.path().join("library"))
        .await
        .unwrap();
    let mut session = Session::memory().await.unwrap();
    let mut kernel = Kernel::new();
    kernel.register(Arc::new(FileOwner)).unwrap();
    kernel.initialize(&mut session).await.unwrap();
    storage.initialize(&mut session).await.unwrap();
    let record = storage.admit(&kernel, &mut session, &source).await.unwrap();
    // Test only opener substitution: deterministic on Windows regardless of ACLs
    // or whether the test process has administrator permissions.
    let denied = storage
        .open_with::<File>(&record, |_| {
            Err(io::Error::from(io::ErrorKind::PermissionDenied))
        })
        .unwrap_err();
    assert!(
        matches!(denied, FileError::Access { id, cause: AccessCause::Denied(_) } if id == record.id)
    );
    let mut input = storage.open_with(&record, |_| Ok(FailingReader)).unwrap();
    assert_eq!(input.id(), record.id);
    let error = input.read(&mut [0; 8]).unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::Other);
    assert_eq!(error.to_string(), "late reader failure");
    assert_eq!(input.id(), record.id);
    assert_eq!(storage.read(&mut session, record.id).await.unwrap(), record);
    assert_eq!(
        std::fs::read(storage.root.join(&record.relative_path)).unwrap(),
        b"retained bytes"
    );
    assert_eq!(std::fs::read(source).unwrap(), b"retained bytes");
}
