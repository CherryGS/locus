#![allow(clippy::expect_used, clippy::unwrap_used)]
mod support;
use diesel::{
    sql_query,
    sql_types::{Binary, Text},
};
use diesel_async::RunQueryDsl;
use locus_core::api::{ComponentId, CoreError, Membership, OwnerError};
use locus_file::api::{AccessCause, FILE_KIND, FileError, FileId};
use support::*;

#[tokio::test(flavor = "multi_thread")]
async fn missing_rows_missing_bytes_and_lifecycle_preserve_known_records() {
    let mut f = Fixture::new().await;
    let absent = FileId::from_component(ComponentId::new());
    assert!(
        matches!(f.files.open(&mut f.session, absent).await, Err(FileError::MissingRecord(id)) if id == absent)
    );
    let record = f
        .files
        .admit(&f.kernel, &mut f.session, &f.source)
        .await
        .unwrap();
    let entity = f.kernel.create_entity(&mut f.session).await.unwrap();
    let membership = Membership {
        entity,
        kind: FILE_KIND,
        component: record.id.component(),
    };
    f.kernel.attach(&mut f.session, membership).await.unwrap();
    assert!(matches!(
        f.kernel
            .delete_component(&mut f.session, FILE_KIND, record.id.component())
            .await,
        Err(CoreError::ComponentAttached(_))
    ));
    f.kernel.detach(&mut f.session, membership).await.unwrap();
    assert_eq!(
        f.files.read(&mut f.session, record.id).await.unwrap(),
        record
    );
    assert!(matches!(
        f.kernel
            .delete_component(&mut f.session, FILE_KIND, record.id.component())
            .await,
        Err(CoreError::Owner(OwnerError::Veto(_)))
    ));
    f.kernel.attach(&mut f.session, membership).await.unwrap();
    f.kernel
        .delete_entity(&mut f.session, entity)
        .await
        .unwrap();
    assert_eq!(
        f.files.read(&mut f.session, record.id).await.unwrap(),
        record
    );
    let object = f.files.root().join(&record.relative_path);
    assert_eq!(
        std::fs::read(&object).unwrap(),
        std::fs::read(&f.source).unwrap()
    );
    // External damage is explicitly simulated; production never removes bytes.
    std::fs::remove_file(&object).unwrap();
    assert!(
        matches!(f.files.open(&mut f.session, record.id).await, Err(FileError::Access { id, cause: AccessCause::MissingBytes(_) }) if id == record.id)
    );
    assert_eq!(
        f.files.read(&mut f.session, record.id).await.unwrap(),
        record
    );
    assert_eq!(
        f.kernel
            .component_kind(&mut f.session, record.id.component())
            .await
            .unwrap(),
        FILE_KIND
    );
    assert!(f.source.is_file());
    assert!(f.database.is_file());
    assert_eq!(
        count(
            &mut f.session,
            "SELECT count(*) AS count FROM locus_file_comp_file"
        )
        .await,
        1
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn corrupt_persisted_paths_and_counts_are_rejected_before_access() {
    let mut f = Fixture::new().await;
    let record = f
        .files
        .admit(&f.kernel, &mut f.session, &f.source)
        .await
        .unwrap();
    for corrupt in [
        "../incoming.dat".to_owned(),
        f.source.display().to_string(),
        "object/0000/00000000000000000000000000000000".to_owned(),
        format!("{}\\..\\incoming.dat", record.relative_path),
        record.relative_path.to_uppercase(),
    ] {
        let id = record.id;
        f.session
            .transaction::<_, FileError, _>(move |context| {
                Box::pin(async move {
                    sql_query("UPDATE locus_file_comp_file SET relative_path = ? WHERE id = ?")
                        .bind::<Text, _>(corrupt)
                        .bind::<Binary, _>(id.as_bytes().as_slice())
                        .execute(context.connection())
                        .await?;
                    Ok(())
                })
            })
            .await
            .unwrap();
        assert!(
            matches!(f.files.open(&mut f.session, record.id).await, Err(FileError::InvalidLocation { id, .. }) if id == record.id)
        );
    }
    for statement in [
        "UPDATE locus_file_comp_file SET id = zeroblob(16)",
        "UPDATE locus_file_comp_file SET byte_count = -1",
        "UPDATE locus_file_comp_file SET byte_count = 1.5",
    ] {
        let result = f
            .session
            .transaction::<_, FileError, _>(move |context| {
                Box::pin(async move {
                    diesel_async::SimpleAsyncConnection::batch_execute(
                        context.connection(),
                        statement,
                    )
                    .await?;
                    Ok(())
                })
            })
            .await;
        assert!(matches!(result, Err(FileError::Database(_))));
    }
    assert!(f.files.root().join(record.relative_path).is_file());
    assert!(f.source.is_file());
}

#[tokio::test(flavor = "multi_thread")]
async fn vanished_or_truncated_prepared_copy_cannot_be_registered() {
    let mut f = Fixture::new().await;
    let prepared = f.files.prepare(&f.source).await.unwrap();
    let object = f.files.root().join(&prepared.progress().relative_path);
    std::fs::write(&object, b"short").unwrap();
    assert!(
        matches!(f.files.register(&f.kernel, &mut f.session, &prepared).await, Err(FileError::PreparedCopyChanged(id)) if id == prepared.id())
    );
    std::fs::remove_file(&object).unwrap();
    assert!(
        matches!(f.files.register(&f.kernel, &mut f.session, &prepared).await, Err(FileError::Access { id, cause: AccessCause::MissingBytes(_) }) if id == prepared.id())
    );
    assert_eq!(
        count(
            &mut f.session,
            "SELECT count(*) AS count FROM locus_file_comp_file"
        )
        .await,
        0
    );
    assert_eq!(
        count(
            &mut f.session,
            "SELECT count(*) AS count FROM locus_core_comm_component_registry"
        )
        .await,
        0
    );
    assert!(f.source.is_file());
}

#[tokio::test(flavor = "multi_thread")]
async fn existing_directory_redirect_cannot_escape_managed_root() {
    let mut f = Fixture::new().await;
    let outside = f.directory.path().join("outside");
    std::fs::create_dir(&outside).unwrap();
    let link = f.files.root().join("object");
    #[cfg(windows)]
    {
        let result = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&outside)
            .output()
            .unwrap();
        assert!(result.status.success(), "junction setup: {:?}", result);
    }
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, &link).unwrap();
    let failure = f
        .files
        .admit(&f.kernel, &mut f.session, &f.source)
        .await
        .unwrap_err();
    assert!(matches!(failure.source, FileError::InvalidLocation { .. }));
    assert_eq!(std::fs::read_dir(outside).unwrap().count(), 0);
    assert_eq!(
        count(
            &mut f.session,
            "SELECT count(*) AS count FROM locus_file_comp_file"
        )
        .await,
        0
    );
    assert!(f.source.is_file());
}
