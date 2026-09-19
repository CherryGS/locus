#![allow(clippy::expect_used, clippy::unwrap_used)]
mod support;
use locus_core::api::{ComponentId, CoreError, Kernel, Membership};
use locus_file::api::{FILE_KIND, InputComparison};
use locus_media::api::*;
use locus_store::api::Session;
use support::*;

#[tokio::test(flavor = "multi_thread")]
async fn retained_facts_retry_reopen_and_real_input_applicability() {
    let mut f = Fixture::new().await;
    let (entity, id) = f.component(MediaKind::Image).await;
    assert_ne!(IMAGE_KIND, VIDEO_KIND);
    assert!(
        f.media
            .read(&mut f.session, id)
            .await
            .unwrap()
            .facts
            .is_none()
    );
    let first = f
        .media
        .interpret(&f.kernel, &f.files, &mut f.session, id)
        .await
        .unwrap();
    assert!(matches!(
        first,
        ApplyOutcome::Accepted(MediaRecord {
            last_failure: Some(AttemptFailure {
                code: FailureCode::MissingInput,
                ..
            }),
            facts: None,
            ..
        })
    ));
    let source = f.png("original.unrelated", 80, 40);
    let file = f.admit(&source, entity).await;
    let successful = f
        .media
        .interpret(&f.kernel, &f.files, &mut f.session, id)
        .await
        .unwrap();
    assert!(matches!(
        successful,
        ApplyOutcome::Accepted(MediaRecord {
            facts: Some(Facts::Image(ImageFacts {
                width: 80,
                height: 40,
                ..
            })),
            last_failure: None,
            ..
        })
    ));
    let record = f.media.read(&mut f.session, id).await.unwrap();
    let membership = Membership {
        entity,
        kind: FILE_KIND,
        component: file.component(),
    };
    f.kernel.detach(&mut f.session, membership).await.unwrap();
    let absent = f.media.view(&f.kernel, &mut f.session, id).await.unwrap();
    assert_eq!(absent.record.facts, record.facts);
    assert!(matches!(
        absent.applicability,
        Applicability::Input(InputComparison::Incomplete { .. })
    ));
    let bad = f.directory.path().join("unsupported.png");
    std::fs::write(&bad, b"not media").unwrap();
    let other = f.admit(&bad, entity).await;
    assert!(
        matches!(f.media.view(&f.kernel,&mut f.session,id).await.unwrap().applicability,Applicability::Input(InputComparison::Changed { basis,current }) if basis == file && current == other)
    );
    f.media
        .interpret(&f.kernel, &f.files, &mut f.session, id)
        .await
        .unwrap();
    let retained = f.media.read(&mut f.session, id).await.unwrap();
    assert_eq!(retained.facts, record.facts);
    assert_eq!(retained.basis, Some(file));
    assert_eq!(
        retained.last_failure.unwrap().code,
        FailureCode::UnsupportedInput
    );
    f.session = Session::open(&f.database).await.unwrap();
    assert_eq!(
        f.media.read(&mut f.session, id).await.unwrap().facts,
        record.facts
    );
    assert_eq!(
        count(
            &mut f.session,
            "SELECT count(*) AS count FROM locus_images WHERE typeof(id)='blob' AND length(id)=16"
        )
        .await,
        1
    );
    f.kernel
        .delete_entity(&mut f.session, entity)
        .await
        .unwrap();
    assert!(matches!(
        f.media
            .view(&f.kernel, &mut f.session, id)
            .await
            .unwrap()
            .applicability,
        Applicability::Unmounted
    ));
    f.kernel
        .delete_component(&mut f.session, IMAGE_KIND, id.component())
        .await
        .unwrap();
    assert!(matches!(
        f.media.read(&mut f.session, id).await,
        Err(MediaError::MissingRecord(_))
    ));
    assert!(f.files.open(&mut f.session, file).await.is_ok());
    assert!(source.is_file());
}

#[tokio::test(flavor = "multi_thread")]
async fn opaque_preparation_rejects_changed_file_host_and_newer_attempt() {
    let mut f = Fixture::new().await;
    let (entity, id) = f.component(MediaKind::Image).await;
    let source = f.png("input", 24, 12);
    let file = f.admit(&source, entity).await;
    let mut other = Session::open(&f.database).await.unwrap();
    let prepared = f
        .media
        .prepare(&f.kernel, &f.files, &mut f.session, id)
        .await
        .unwrap();
    f.kernel
        .detach(
            &mut other,
            Membership {
                entity,
                kind: FILE_KIND,
                component: file.component(),
            },
        )
        .await
        .unwrap();
    assert_eq!(
        f.media
            .apply(&f.kernel, &mut f.session, prepared)
            .await
            .unwrap(),
        ApplyOutcome::RejectedContextChanged
    );
    f.kernel
        .attach(
            &mut other,
            Membership {
                entity,
                kind: FILE_KIND,
                component: file.component(),
            },
        )
        .await
        .unwrap();
    let prepared = f
        .media
        .prepare(&f.kernel, &f.files, &mut f.session, id)
        .await
        .unwrap();
    let host2 = f.kernel.create_entity(&mut other).await.unwrap();
    f.kernel
        .detach(
            &mut other,
            Membership {
                entity,
                kind: IMAGE_KIND,
                component: id.component(),
            },
        )
        .await
        .unwrap();
    f.kernel
        .attach(
            &mut other,
            Membership {
                entity: host2,
                kind: IMAGE_KIND,
                component: id.component(),
            },
        )
        .await
        .unwrap();
    assert_eq!(
        f.media
            .apply(&f.kernel, &mut f.session, prepared)
            .await
            .unwrap(),
        ApplyOutcome::RejectedContextChanged
    );
    let prepared = f
        .media
        .prepare(&f.kernel, &f.files, &mut f.session, id)
        .await
        .unwrap();
    f.media
        .interpret(&f.kernel, &f.files, &mut other, id)
        .await
        .unwrap();
    assert_eq!(
        f.media
            .apply(&f.kernel, &mut f.session, prepared)
            .await
            .unwrap(),
        ApplyOutcome::RejectedNewerAttempt
    );
    let prepared = f
        .media
        .prepare(&f.kernel, &f.files, &mut f.session, id)
        .await
        .unwrap();
    drop(prepared);
    assert_eq!(f.media.read(&mut f.session, id).await.unwrap().revision, 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn participant_creation_savepoint_and_apply_rollback() {
    let mut f = Fixture::new().await;
    let no_owner = Kernel::new();
    f.session
        .transaction::<_, MediaError, _>(move |c| {
            Box::pin(async move {
                assert!(
                    MediaService::create_in(&no_owner, c, MediaKind::Image)
                        .await
                        .is_err()
                );
                Ok(())
            })
        })
        .await
        .unwrap();
    assert_eq!(
        count(&mut f.session, "SELECT count(*) AS count FROM locus_images").await,
        0
    );
    let kernel = f.kernel.clone();
    assert!(
        f.session
            .transaction::<(), MediaError, _>(move |c| Box::pin(async move {
                MediaService::create_in(&kernel, c, MediaKind::Video).await?;
                Err(MediaError::Configuration("rollback".into()))
            }))
            .await
            .is_err()
    );
    assert_eq!(
        count(&mut f.session, "SELECT count(*) AS count FROM locus_videos").await,
        0
    );
    let (entity, id) = f.component(MediaKind::Image).await;
    let path = f.png("png", 8, 8);
    f.admit(&path, entity).await;
    let prepared = f
        .media
        .prepare(&f.kernel, &f.files, &mut f.session, id)
        .await
        .unwrap();
    let kernel = f.kernel.clone();
    assert!(
        f.session
            .transaction::<(), MediaError, _>(move |c| Box::pin(async move {
                assert!(matches!(
                    MediaService::apply_in(&kernel, c, prepared).await?,
                    ApplyOutcome::Accepted(_)
                ));
                Err(MediaError::Configuration("rollback apply".into()))
            }))
            .await
            .is_err()
    );
    assert!(
        f.media
            .read(&mut f.session, id)
            .await
            .unwrap()
            .facts
            .is_none()
    );
    assert!(matches!(
        f.kernel
            .delete_component(&mut f.session, IMAGE_KIND, id.component())
            .await,
        Err(CoreError::ComponentAttached(_))
    ));
}

#[tokio::test(flavor = "multi_thread")]
async fn common_view_retains_corrupt_entry_and_distinguishes_membership_errors() {
    let mut f = Fixture::new().await;
    let (entity, image) = f.component(MediaKind::Image).await;
    let video = f
        .media
        .create_video(&f.kernel, &mut f.session)
        .await
        .unwrap();
    f.attach(entity, video.into()).await;
    execute(
        &mut f.session,
        "UPDATE locus_images SET payload = '{}'".into(),
    )
    .await;
    let entries = f
        .media
        .entity_view(&f.kernel, &mut f.session, entity)
        .await
        .unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries.iter().filter(|e| e.result.is_err()).count(), 1);
    let empty = f.kernel.create_entity(&mut f.session).await.unwrap();
    assert!(
        f.media
            .entity_view(&f.kernel, &mut f.session, empty)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        f.media
            .entity_view(&f.kernel, &mut f.session, locus_core::api::EntityId::new())
            .await
            .is_err()
    );
    assert!(
        f.media
            .read(&mut f.session, VideoId::from_component(image.component()))
            .await
            .is_err()
    );
    assert!(
        f.kernel
            .attachment(&mut f.session, ComponentId::new())
            .await
            .is_err()
    );
    let unregistered = Kernel::new();
    assert!(
        unregistered
            .attachment(&mut f.session, video.component())
            .await
            .unwrap()
            .is_some()
    );
    f.kernel
        .delete_entity(&mut f.session, entity)
        .await
        .unwrap();
    assert_eq!(
        unregistered
            .attachment(&mut f.session, video.component())
            .await
            .unwrap(),
        None
    );
    assert!(f.media.read(&mut f.session, video).await.is_ok());
}

#[tokio::test(flavor = "multi_thread")]
async fn missing_file_payload_is_not_missing_membership_and_invalid_payload_is_not_unparsed() {
    let mut f = Fixture::new().await;
    let (entity, id) = f.component(MediaKind::Image).await;
    let path = f.png("input", 8, 8);
    f.admit(&path, entity).await;
    f.media
        .interpret(&f.kernel, &f.files, &mut f.session, id)
        .await
        .unwrap();
    let record = f.media.read(&mut f.session, id).await.unwrap();
    execute(&mut f.session, "DELETE FROM locus_files".into()).await;
    let view = f.media.view(&f.kernel, &mut f.session, id).await.unwrap();
    assert_eq!(view.record, record);
    assert!(matches!(
        view.applicability,
        Applicability::Error(MediaError::File(locus_file::api::FileError::MissingRecord(
            _
        )))
    ));
    assert!(matches!(
        f.media
            .interpret(&f.kernel, &f.files, &mut f.session, id)
            .await
            .unwrap(),
        ApplyOutcome::Accepted(MediaRecord {
            facts: Some(_),
            last_failure: Some(AttemptFailure {
                code: FailureCode::FileAccess,
                ..
            }),
            ..
        })
    ));
    for payload in [
        r#"{"version":1,"basis":null,"facts":{"Image":{"format":"Png","width":0,"height":1}},"last_failure":null}"#,
        r#"{"version":1,"basis":null,"facts":null,"last_failure":null,"unknown":42}"#,
        r#"{"version":2,"basis":null,"facts":null,"last_failure":null}"#,
    ] {
        execute(
            &mut f.session,
            format!("UPDATE locus_images SET payload = '{payload}'"),
        )
        .await;
        assert!(matches!(
            f.media.read(&mut f.session, id).await,
            Err(MediaError::Corrupt(_))
        ));
    }
    execute(&mut f.session, "DELETE FROM locus_images".into()).await;
    assert!(matches!(
        f.media.read(&mut f.session, id).await,
        Err(MediaError::MissingRecord(_))
    ));
    let entries = f
        .media
        .entity_view(&f.kernel, &mut f.session, entity)
        .await
        .unwrap();
    assert_eq!(entries.len(), 1);
    assert!(matches!(
        entries[0].result,
        Err(MediaError::MissingRecord(_))
    ));
}
