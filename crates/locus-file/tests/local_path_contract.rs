#![allow(clippy::expect_used, clippy::unwrap_used)]
mod support;
use locus_file::api::{AccessCause, FileError};
use std::io::Read;
use support::*;

#[tokio::test(flavor = "multi_thread")]
async fn identified_local_adapter_keeps_handle_and_checks_record_location_and_regular_file() {
    let mut f = Fixture::new().await;
    let record = f
        .files
        .admit(&f.kernel, &mut f.session, &f.source)
        .await
        .unwrap();
    let local = f.files.local_path(&mut f.session, record.id).await.unwrap();
    assert_eq!(local.id(), record.id);
    assert!(local.path().is_file());
    let path = local.path().to_path_buf();
    let mut reader = local.into_reader();
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes).unwrap();
    assert_eq!(bytes, std::fs::read(&f.source).unwrap());
    drop(reader);
    let displaced = path.with_extension("displaced");
    std::fs::rename(&path, &displaced).unwrap();
    assert!(matches!(
        f.files.local_path(&mut f.session, record.id).await,
        Err(FileError::Access {
            cause: AccessCause::MissingBytes(_),
            ..
        })
    ));
    std::fs::create_dir(&path).unwrap();
    assert!(f.files.local_path(&mut f.session, record.id).await.is_err());
    std::fs::remove_dir(&path).unwrap();
    std::fs::rename(&displaced, &path).unwrap();
    execute(
        &mut f.session,
        "UPDATE locus_file_comp_file SET relative_path = '../outside'",
    )
    .await;
    assert!(matches!(
        f.files.local_path(&mut f.session, record.id).await,
        Err(FileError::InvalidLocation { .. })
    ));
    assert!(path.is_file());
    assert!(f.source.is_file());
    assert!(f.database.is_file());
    assert!(f.source.starts_with(f.directory.path()));
    assert_eq!(
        count(
            &mut f.session,
            "SELECT count(*) AS count FROM locus_file_comp_file"
        )
        .await,
        1
    );
}
