#![allow(clippy::expect_used, clippy::unwrap_used)]
mod support;
use locus_core::api::{CoreError, Kernel};
use locus_file::api::{FILE_KIND, FileError, FileService};
use locus_store::api::{Session, StoreError};
use std::io::Read;
use support::*;

#[tokio::test(flavor = "multi_thread")]
async fn real_copy_reopens_binary_identity_exact_bytes_and_original() {
    let mut f = Fixture::new().await;
    let record = f
        .files
        .admit(&f.kernel, &mut f.session, &f.source)
        .await
        .unwrap();
    let hex = record.id.component().as_uuid().simple().to_string();
    assert_eq!(record.relative_path, format!("object/{}/{hex}", &hex[28..]));
    assert_eq!(
        record.byte_count,
        std::fs::metadata(&f.source).unwrap().len()
    );
    assert_eq!(count(&mut f.session, "SELECT count(*) AS count FROM locus_file_comp_file WHERE typeof(id) = 'blob' AND length(id) = 16").await, 1);
    assert_eq!(
        f.kernel
            .component_kind(&mut f.session, record.id.component())
            .await
            .unwrap(),
        FILE_KIND
    );
    assert_eq!(
        count(
            &mut f.session,
            "SELECT count(*) AS count FROM locus_core_comm_entity"
        )
        .await,
        0
    );
    let second = f
        .files
        .admit(&f.kernel, &mut f.session, &f.source)
        .await
        .unwrap();
    assert_ne!(record.id, second.id); // Equal contents do not deduplicate.
    drop(f.session);
    let files = FileService::new(f.files.root()).await.unwrap();
    let mut session = Session::open(f.database).await.unwrap();
    locus_migration::api::migrate(&mut session).await.unwrap();
    assert_eq!(files.read(&mut session, record.id).await.unwrap(), record);
    let mut input = files.open(&mut session, record.id).await.unwrap();
    let mut bytes = Vec::new();
    input.read_to_end(&mut bytes).unwrap();
    assert_eq!(input.id(), record.id);
    assert_eq!(bytes, std::fs::read(&f.source).unwrap());
}

#[tokio::test(flavor = "multi_thread")]
async fn missing_source_and_different_root_never_register_a_file() {
    let mut f = Fixture::new().await;
    let missing = f
        .files
        .admit(&f.kernel, &mut f.session, f.directory.path().join("absent"))
        .await
        .unwrap_err();
    assert!(!missing.progress.copy_complete);
    assert!(!missing.progress.managed_bytes_may_exist);
    assert!(
        matches!(missing.source, FileError::Io { source, .. } if source.kind() == std::io::ErrorKind::NotFound)
    );
    let prepared = f.files.prepare(&f.source).await.unwrap();
    let other = FileService::new(f.directory.path().join("other"))
        .await
        .unwrap();
    assert!(matches!(
        other.register(&f.kernel, &mut f.session, &prepared).await,
        Err(FileError::WrongRoot)
    ));
    assert_eq!(
        count(
            &mut f.session,
            "SELECT count(*) AS count FROM locus_file_comp_file"
        )
        .await,
        0
    );
    assert!(
        f.files
            .root()
            .join(&prepared.progress().relative_path)
            .is_file()
    );
    assert!(f.source.is_file());
}

#[tokio::test(flavor = "multi_thread")]
async fn caught_registration_error_rolls_back_payload_but_commits_unrelated_outer_work() {
    let mut f = Fixture::new().await;
    let prepared = f.files.prepare(&f.source).await.unwrap();
    let files = f.files.clone();
    let participant = prepared.clone();
    // No File owner: core admission fails AFTER the payload insert. Catching this
    // error must still undo that insert even though the outer transaction commits.
    let unrelated = f
        .session
        .transaction::<_, FileError, _>(move |context| {
            Box::pin(async move {
                let kernel = Kernel::new();
                let error = files
                    .register_in(&kernel, context, &participant)
                    .await
                    .unwrap_err();
                assert!(matches!(
                    error,
                    FileError::Core(CoreError::UnavailableKind(FILE_KIND))
                ));
                Ok(kernel.create_entity_in(context).await?)
            })
        })
        .await
        .unwrap();
    assert!(
        f.kernel
            .entity_exists(&mut f.session, unrelated)
            .await
            .unwrap()
    );
    assert!(matches!(
        f.files.read(&mut f.session, prepared.id()).await,
        Err(FileError::MissingRecord(_))
    ));
    assert!(matches!(
        f.kernel
            .component_kind(&mut f.session, prepared.id().component())
            .await,
        Err(CoreError::MissingComponent(_))
    ));
    assert_eq!(
        std::fs::read(f.files.root().join(&prepared.progress().relative_path)).unwrap(),
        std::fs::read(&f.source).unwrap()
    );
    // The retained opaque value can still be explicitly registered later.
    f.files
        .register(&f.kernel, &mut f.session, &prepared)
        .await
        .unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn group_rollback_and_standalone_commit_error_keep_completed_copy_progress() {
    let mut f = Fixture::new().await;
    let prepared = f.files.prepare(&f.source).await.unwrap();
    let files = f.files.clone();
    let kernel = f.kernel.clone();
    let participant = prepared.clone();
    let rollback = f
        .session
        .transaction::<(), FileError, _>(move |context| {
            Box::pin(async move {
                files.register_in(&kernel, context, &participant).await?;
                Err(FileError::NotRegularFile)
            })
        })
        .await;
    assert!(matches!(rollback, Err(FileError::NotRegularFile)));
    assert!(matches!(
        f.files.read(&mut f.session, prepared.id()).await,
        Err(FileError::MissingRecord(_))
    ));
    assert!(matches!(
        f.kernel
            .component_kind(&mut f.session, prepared.id().component())
            .await,
        Err(CoreError::MissingComponent(_))
    ));
    assert_eq!(
        std::fs::read(f.files.root().join(&prepared.progress().relative_path)).unwrap(),
        std::fs::read(&f.source).unwrap()
    );
    execute(&mut f.session, "CREATE TABLE test_parent (id INTEGER PRIMARY KEY);
        CREATE TABLE test_deferred (parent INTEGER REFERENCES test_parent(id) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER fail_commit AFTER INSERT ON locus_file_comp_file BEGIN INSERT INTO test_deferred VALUES (1); END;").await;
    let error = f
        .files
        .admit(&f.kernel, &mut f.session, &f.source)
        .await
        .unwrap_err();
    assert!(matches!(
        error.source,
        FileError::Store(StoreError::CommitOutcomeUnknown(_))
    ));
    assert!(error.progress.copy_complete);
    assert!(error.progress.managed_bytes_may_exist);
    assert!(!f.session.is_usable());
    assert_eq!(
        std::fs::read(error.progress.root.join(error.progress.relative_path)).unwrap(),
        std::fs::read(&f.source).unwrap()
    );
}
