#![allow(clippy::expect_used, clippy::unwrap_used)]
mod support;
use locus_core::api::Membership;
use locus_file::api::FILE_KIND;
use locus_media::api::*;
use support::*;

#[tokio::test(flavor = "multi_thread")]
async fn recognition_has_no_components_writes_or_cache_and_preserves_failures() {
    let mut f = Fixture::configured(MediaConfig {
        ffprobe: "missing-probe-for-recognition-test".into(),
        ..MediaConfig::default()
    })
    .await;
    let source = f.png("content.bin", 8, 4);
    let file = f
        .files
        .admit(&f.kernel, &mut f.session, &source)
        .await
        .unwrap();
    let observed = f
        .media
        .recognize(&f.files, &mut f.session, file.id)
        .await
        .unwrap();
    assert_eq!(observed.file, file.id);
    assert_eq!(observed.image, Recognition::Match);
    assert_eq!(observed.video, Recognition::NoMatch);
    assert_eq!(
        count(
            &mut f.session,
            "SELECT count(*) AS count FROM locus_media_comp_image"
        )
        .await,
        0
    );
    assert_eq!(
        count(
            &mut f.session,
            "SELECT count(*) AS count FROM locus_media_comp_video"
        )
        .await,
        0
    );
    assert_eq!(
        count(
            &mut f.session,
            "SELECT count(*) AS count FROM locus_core_comm_entity"
        )
        .await,
        0
    );
    let video = f.directory.path().join("candidate");
    std::fs::write(&video, b"\0\0\0\x14ftypisom\0\0\0\0mp42").unwrap();
    let video = f
        .files
        .admit(&f.kernel, &mut f.session, video)
        .await
        .unwrap();
    let observed = f
        .media
        .recognize(&f.files, &mut f.session, video.id)
        .await
        .unwrap();
    assert_eq!(observed.image, Recognition::NoMatch);
    assert!(matches!(
        observed.video,
        Recognition::Failed(AttemptFailure {
            code: FailureCode::ToolUnavailable,
            ..
        })
    ));
    assert_eq!(std::fs::read_dir(f.media.cache_root()).unwrap().count(), 0);
    std::fs::remove_file(f.files.root().join(file.relative_path)).unwrap();
    assert!(matches!(
        f.media.recognize(&f.files, &mut f.session, file.id).await,
        Err(MediaError::File(_))
    ));
}

#[tokio::test(flavor = "multi_thread")]
async fn expected_capture_and_acceptance_reject_replacements_and_newer_revisions() {
    let mut f = Fixture::new().await;
    let (entity, id) = f.component(MediaKind::Image).await;
    let source = f.png("image", 8, 4);
    let file = f.admit(&source, entity).await;
    let expected = ExpectedInput {
        entity,
        file,
        revision: Some(0),
    };
    let prepared = f
        .media
        .prepare_expected(&f.kernel, &f.files, &mut f.session, id, Some(expected))
        .await
        .unwrap();
    f.kernel
        .detach(
            &mut f.session,
            Membership {
                entity,
                kind: FILE_KIND,
                component: file.component(),
            },
        )
        .await
        .unwrap();
    let replacement = f.admit(&source, entity).await;
    assert_ne!(replacement, file);
    assert!(matches!(
        f.media
            .apply(&f.kernel, &mut f.session, prepared)
            .await
            .unwrap(),
        ApplyOutcome::RejectedContextChanged
    ));
    assert!(matches!(
        f.media
            .prepare_expected(&f.kernel, &f.files, &mut f.session, id, Some(expected))
            .await,
        Err(MediaError::ContextChanged)
    ));
    assert!(matches!(
        f.media
            .preview_expected(
                &f.kernel,
                &f.files,
                &mut f.session,
                id,
                Rendition { edge: 32 },
                Some(expected)
            )
            .await,
        Err(MediaError::ContextChanged)
    ));
    let expected = ExpectedInput {
        file: replacement,
        ..expected
    };
    let prepared = f
        .media
        .prepare_expected(&f.kernel, &f.files, &mut f.session, id, Some(expected))
        .await
        .unwrap();
    f.media
        .interpret(&f.kernel, &f.files, &mut f.session, id)
        .await
        .unwrap();
    assert!(matches!(
        f.media
            .apply(&f.kernel, &mut f.session, prepared)
            .await
            .unwrap(),
        ApplyOutcome::RejectedNewerAttempt
    ));
    assert!(matches!(
        f.media
            .prepare_expected(&f.kernel, &f.files, &mut f.session, id, Some(expected))
            .await,
        Err(MediaError::NewerAttempt)
    ));
}
