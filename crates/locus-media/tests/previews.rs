#![allow(clippy::expect_used, clippy::unwrap_used)]
mod support;
use locus_core::api::Membership;
use locus_file::api::FILE_KIND;
use locus_media::api::*;
use support::*;

#[tokio::test(flavor = "multi_thread")]
async fn image_cache_input_rendition_validation_clear_and_source_independence() {
    let mut f = Fixture::new().await;
    let (entity, id) = f.component(MediaKind::Image).await;
    let source = f.png("original", 100, 50);
    let file = f.admit(&source, entity).await;
    f.media
        .interpret(&f.kernel, &f.files, &mut f.session, id)
        .await
        .unwrap();
    let rendition = Rendition { edge: 32 };
    let first = f
        .media
        .preview(&f.kernel, &f.files, &mut f.session, id, rendition)
        .await
        .unwrap();
    assert_eq!(first.origin, PreviewOrigin::Generated);
    assert_eq!(image::image_dimensions(&first.path).unwrap(), (32, 16));
    let other_size = f
        .media
        .preview(
            &f.kernel,
            &f.files,
            &mut f.session,
            id,
            Rendition { edge: 20 },
        )
        .await
        .unwrap();
    assert_ne!(first.path, other_size.path);
    let managed = f.files.local_path(&mut f.session, file).await.unwrap();
    let managed_path = managed.path().to_path_buf();
    drop(managed);
    let held = managed_path.with_extension("temporarily-absent");
    std::fs::rename(&managed_path, &held).unwrap();
    assert_eq!(
        f.media
            .preview(&f.kernel, &f.files, &mut f.session, id, rendition)
            .await
            .unwrap()
            .origin,
        PreviewOrigin::Hit
    );
    assert!(f.media.clear_cache().await.unwrap() >= 2);
    assert!(
        f.media
            .preview(&f.kernel, &f.files, &mut f.session, id, rendition)
            .await
            .is_err()
    );
    std::fs::rename(&held, &managed_path).unwrap();
    let rebuilt = f
        .media
        .preview(&f.kernel, &f.files, &mut f.session, id, rendition)
        .await
        .unwrap();
    assert_eq!(rebuilt.origin, PreviewOrigin::Generated);
    std::fs::write(&rebuilt.path, b"partial png").unwrap();
    assert_eq!(
        f.media
            .preview(&f.kernel, &f.files, &mut f.session, id, rendition)
            .await
            .unwrap()
            .origin,
        PreviewOrigin::Generated
    );
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
    let source2 = f.png("second", 20, 40);
    let file2 = f.admit(&source2, entity).await;
    let second = f
        .media
        .preview(&f.kernel, &f.files, &mut f.session, id, rendition)
        .await
        .unwrap();
    assert_eq!(second.file, file2);
    assert_ne!(second.path, first.path);
    assert_eq!(
        f.media.read(&mut f.session, id).await.unwrap().basis,
        Some(file)
    );
    assert!(managed_path.is_file());
    assert!(source.is_file());
}

#[tokio::test(flavor = "multi_thread")]
async fn basic_image_facts_can_succeed_while_pixel_decode_fails() {
    let mut f = Fixture::new().await;
    let (entity, id) = f.component(MediaKind::Image).await;
    let path = f.png("truncated", 80, 40);
    let bytes = std::fs::read(&path).unwrap();
    let data = bytes.windows(4).position(|v| v == b"IDAT").unwrap();
    std::fs::write(&path, &bytes[..data + 4]).unwrap();
    f.admit(&path, entity).await;
    let attempt = f
        .media
        .interpret(&f.kernel, &f.files, &mut f.session, id)
        .await
        .unwrap();
    assert!(matches!(
        attempt,
        ApplyOutcome::Accepted(MediaRecord {
            facts: Some(_),
            last_failure: None,
            ..
        })
    ));
    assert!(
        f.media
            .preview(
                &f.kernel,
                &f.files,
                &mut f.session,
                id,
                Rendition { edge: 30 }
            )
            .await
            .is_err()
    );
    assert!(
        f.media
            .read(&mut f.session, id)
            .await
            .unwrap()
            .last_failure
            .is_none()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn image_limits_and_cache_nonregular_entries_fail_without_deleting_sources() {
    let mut f = Fixture::configured(MediaConfig {
        max_pixels: 16,
        ..MediaConfig::default()
    })
    .await;
    let (entity, id) = f.component(MediaKind::Image).await;
    let path = f.png("too-big", 8, 8);
    f.admit(&path, entity).await;
    assert!(matches!(
        f.media
            .interpret(&f.kernel, &f.files, &mut f.session, id)
            .await
            .unwrap(),
        ApplyOutcome::Accepted(MediaRecord {
            facts: None,
            last_failure: Some(AttemptFailure {
                code: FailureCode::Limit,
                ..
            }),
            ..
        })
    ));
    std::fs::create_dir(f.media.cache_root().join("media-unexpected.png")).unwrap();
    assert!(f.media.clear_cache().await.is_err());
    assert!(path.is_file());
}

#[tokio::test(flavor = "multi_thread")]
async fn cache_directory_redirect_rejects_reads_and_cleanup_before_touching_target() {
    let mut f = Fixture::new().await;
    let (entity, id) = f.component(MediaKind::Image).await;
    let path = f.png("source", 16, 16);
    f.admit(&path, entity).await;
    let produced = f
        .media
        .preview(
            &f.kernel,
            &f.files,
            &mut f.session,
            id,
            Rendition { edge: 16 },
        )
        .await
        .unwrap();
    f.media.clear_cache().await.unwrap();
    let outside = f.directory.path().join("outside");
    std::fs::create_dir(&outside).unwrap();
    let sentinel = outside.join("media-keep.png");
    std::fs::write(&sentinel, b"external bytes").unwrap();
    std::fs::remove_dir(f.media.cache_root()).unwrap();
    #[cfg(windows)]
    {
        let output = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(f.media.cache_root())
            .arg(&outside)
            .output()
            .unwrap();
        assert!(output.status.success());
    }
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, f.media.cache_root()).unwrap();
    let media = f.media.clone();
    locus_task::api::TaskQueue::new()
        .submit("reject redirected read", move |task| async move {
            assert!(media.open_preview(&task, &produced).await.is_err());
        })
        .unwrap()
        .result()
        .await
        .unwrap();
    assert!(f.media.clear_cache().await.is_err());
    assert!(
        f.media
            .preview(
                &f.kernel,
                &f.files,
                &mut f.session,
                id,
                Rendition { edge: 16 }
            )
            .await
            .is_err()
    );
    assert_eq!(std::fs::read(sentinel).unwrap(), b"external bytes");
    assert!(path.is_file());
}

#[tokio::test(flavor = "multi_thread")]
async fn supported_image_formats_are_detected_from_content() {
    let mut f = Fixture::new().await;
    for (format, expected) in [
        (image::ImageFormat::Png, ImageFormat::Png),
        (image::ImageFormat::Jpeg, ImageFormat::Jpeg),
        (image::ImageFormat::WebP, ImageFormat::WebP),
        (image::ImageFormat::Gif, ImageFormat::Gif),
    ] {
        let path = f.directory.path().join(format!("input-{format:?}.wrong"));
        image::RgbImage::from_pixel(12, 8, image::Rgb([20, 50, 100]))
            .save_with_format(&path, format)
            .unwrap();
        let (entity, id) = f.component(MediaKind::Image).await;
        f.admit(&path, entity).await;
        assert!(
            matches!(f.media.interpret(&f.kernel,&f.files,&mut f.session,id).await.unwrap(),ApplyOutcome::Accepted(MediaRecord{facts:Some(Facts::Image(ImageFacts{format,width:12,height:8})),..}) if format==expected)
        );
        let preview = f
            .media
            .preview(
                &f.kernel,
                &f.files,
                &mut f.session,
                id,
                Rendition { edge: 6 },
            )
            .await
            .unwrap();
        assert_eq!(image::image_dimensions(preview.path).unwrap(), (6, 4));
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn image_output_limit_is_separate_from_accepted_basic_facts() {
    let mut f = Fixture::configured(MediaConfig {
        max_output_bytes: 16,
        ..MediaConfig::default()
    })
    .await;
    let (entity, id) = f.component(MediaKind::Image).await;
    let path = f.png("png", 8, 8);
    f.admit(&path, entity).await;
    f.media
        .interpret(&f.kernel, &f.files, &mut f.session, id)
        .await
        .unwrap();
    assert!(matches!(
        f.media
            .preview(
                &f.kernel,
                &f.files,
                &mut f.session,
                id,
                Rendition { edge: 8 }
            )
            .await,
        Err(MediaError::Attempt(AttemptFailure {
            code: FailureCode::Limit,
            ..
        }))
    ));
    let record = f.media.read(&mut f.session, id).await.unwrap();
    assert!(record.facts.is_some());
    assert!(record.last_failure.is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn opening_produced_preview_rechecks_descriptor_boundary_and_never_regenerates() {
    let mut f = Fixture::new().await;
    let (entity, id) = f.component(MediaKind::Image).await;
    let path = f.png("open-preview", 32, 20);
    f.admit(&path, entity).await;
    let preview = f
        .media
        .preview(
            &f.kernel,
            &f.files,
            &mut f.session,
            id,
            Rendition { edge: 16 },
        )
        .await
        .unwrap();
    let path = preview.path.clone();
    let media = f.media.clone();
    let queue = locus_task::api::TaskQueue::new();
    queue
        .submit("open produced", move |task| async move {
            let file = media.open_preview(&task, &preview).await.unwrap().unwrap();
            assert!(file.metadata().unwrap().len() > 0);
            drop(file);
            let mut invalid = Preview {
                path: preview.path.with_file_name("outside.png"),
                ..preview
            };
            assert!(media.open_preview(&task, &invalid).await.is_err());
            invalid.path = path.clone();
            std::fs::remove_file(&path).unwrap();
            assert!(media.open_preview(&task, &invalid).await.unwrap().is_none());
            assert!(!path.exists());
            std::fs::create_dir(&path).unwrap();
            assert!(media.open_preview(&task, &invalid).await.is_err());
        })
        .unwrap()
        .result()
        .await
        .unwrap();
}
