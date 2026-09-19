use super::ApplicationStorage;
use std::io::Read;

#[tokio::test(flavor = "multi_thread")]
async fn injected_root_composes_real_file_admission_and_reopen() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("library");
    let source = directory.path().join("original.bin");
    std::fs::write(&source, b"application composition").unwrap();
    let mut app = ApplicationStorage::open(&root).await.unwrap();
    let record = app
        .files
        .admit(&app.kernel, &mut app.session, &source)
        .await
        .unwrap();
    assert_eq!(
        app.kernel
            .component_kind(&mut app.session, record.id.component())
            .await
            .unwrap(),
        locus_file::api::FILE_KIND
    );
    drop(app);
    assert!(root.join("metadata.sqlite").is_file());
    let mut app = ApplicationStorage::open(root).await.unwrap();
    let mut input = app.files.open(&mut app.session, record.id).await.unwrap();
    let mut bytes = Vec::new();
    input.read_to_end(&mut bytes).unwrap();
    assert_eq!(bytes, b"application composition");
    assert_eq!(input.id(), record.id);
    assert_eq!(std::fs::read(source).unwrap(), bytes);
}

#[tokio::test(flavor = "multi_thread")]
async fn injected_root_registers_independent_media_kinds_without_decoders() {
    let directory = tempfile::tempdir().unwrap();
    let mut app = ApplicationStorage::open(directory.path()).await.unwrap();
    let image = app
        .media
        .create_image(&app.kernel, &mut app.session)
        .await
        .unwrap();
    let video = app
        .media
        .create_video(&app.kernel, &mut app.session)
        .await
        .unwrap();
    assert_ne!(image.component(), video.component());
    assert_eq!(
        app.kernel
            .component_kind(&mut app.session, image.component())
            .await
            .unwrap(),
        locus_media::api::IMAGE_KIND
    );
    assert_eq!(
        app.kernel
            .component_kind(&mut app.session, video.component())
            .await
            .unwrap(),
        locus_media::api::VIDEO_KIND
    );
    drop(app);
    let mut app = ApplicationStorage::open(directory.path()).await.unwrap();
    assert!(
        app.media
            .read(&mut app.session, image)
            .await
            .unwrap()
            .facts
            .is_none()
    );
    assert!(
        app.media
            .read(&mut app.session, video)
            .await
            .unwrap()
            .facts
            .is_none()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn twitter_snapshot_survives_failed_file_admission_and_reopen() {
    use locus_core::api::Membership;
    use locus_twitter::api::{TWITTER_KIND, TwitterSnapshot};

    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("library");
    let mut app = ApplicationStorage::open(&root).await.unwrap();
    let entity = app.kernel.create_entity(&mut app.session).await.unwrap();
    let id = app
        .twitter
        .create(
            &app.kernel,
            &mut app.session,
            TwitterSnapshot {
                post_id: Some("1234567890123456789".into()),
                text: Some(String::new()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    app.kernel
        .attach(
            &mut app.session,
            Membership {
                entity,
                kind: TWITTER_KIND,
                component: id.component(),
            },
        )
        .await
        .unwrap();
    let saved = app.twitter.read(&mut app.session, id).await.unwrap();
    assert!(saved.basis.is_none());
    assert!(
        app.files
            .admit(
                &app.kernel,
                &mut app.session,
                directory.path().join("missing")
            )
            .await
            .is_err()
    );
    drop(app);
    let mut app = ApplicationStorage::open(&root).await.unwrap();
    assert_eq!(app.twitter.read(&mut app.session, id).await.unwrap(), saved);
    assert_eq!(
        app.kernel
            .memberships(&mut app.session, entity)
            .await
            .unwrap(),
        vec![Membership {
            entity,
            kind: TWITTER_KIND,
            component: id.component(),
        }]
    );
}
