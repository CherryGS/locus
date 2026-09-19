#![allow(clippy::expect_used, clippy::unwrap_used)]
mod support;
use locus_media::api::*;
use std::{path::PathBuf, process::Command};
use support::*;

fn tools() -> MediaConfig {
    MediaConfig {
        ffprobe: std::env::var_os("LOCUS_FFPROBE")
            .map(PathBuf::from)
            .unwrap_or_else(|| "ffprobe".into()),
        ffmpeg: std::env::var_os("LOCUS_FFMPEG")
            .map(PathBuf::from)
            .unwrap_or_else(|| "ffmpeg".into()),
        ..MediaConfig::default()
    }
}
#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires explicit provisioned ffprobe/ffmpeg; run just rust-test-video"]
async fn real_video_audio_multiple_streams_cover_cache_and_retry() {
    let config = tools();
    let mut f = Fixture::configured(config.clone()).await;
    let path = f.directory.path().join("movie 输入 space.mp4");
    let output = Command::new(&config.ffmpeg)
        .args([
            "-v",
            "error",
            "-nostdin",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=64x40:r=5:d=1",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=128x96:r=5:d=1",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-map",
            "0:v",
            "-map",
            "1:v",
            "-map",
            "2:a",
            "-c:v",
            "mpeg4",
            "-c:a",
            "aac",
            "-threads",
            "1",
            "-y",
        ])
        .arg(&path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let (entity, image) = f.component(MediaKind::Image).await;
    let original_image = f.png("before-video", 16, 8);
    let old_file = f.admit(&original_image, entity).await;
    f.media
        .interpret(&f.kernel, &f.files, &mut f.session, image)
        .await
        .unwrap();
    f.kernel
        .detach(
            &mut f.session,
            locus_core::api::Membership {
                entity,
                kind: locus_file::api::FILE_KIND,
                component: old_file.component(),
            },
        )
        .await
        .unwrap();
    let id = f
        .media
        .create(&f.kernel, &mut f.session, MediaKind::Video)
        .await
        .unwrap();
    f.attach(entity, id).await;
    let file = f.admit(&path, entity).await;
    let result = f
        .media
        .interpret(&f.kernel, &f.files, &mut f.session, id)
        .await
        .unwrap();
    let ApplyOutcome::Accepted(record) = result else {
        panic!("not accepted")
    };
    let Some(Facts::Video(facts)) = record.facts else {
        panic!("no video facts: {:?}", record.last_failure)
    };
    assert_eq!(facts.container, "mov");
    assert_eq!(facts.stream_index, 0);
    assert_eq!(facts.width, Some(64));
    assert_eq!(facts.height, Some(40));
    assert_eq!(facts.codec.as_deref(), Some("mpeg4"));
    assert!(facts.duration.is_some());
    let entries = f
        .media
        .entity_view(&f.kernel, &mut f.session, entity)
        .await
        .unwrap();
    assert_eq!(entries.len(), 2);
    assert!(entries.iter().any(|entry| matches!(&entry.result,Ok(MediaView{record:MediaRecord{facts:Some(Facts::Image(_)),..},applicability:Applicability::Input(locus_file::api::InputComparison::Changed{basis,current})}) if *basis==old_file && *current==file)));
    assert!(entries.iter().any(|entry| matches!(&entry.result,Ok(MediaView{record:MediaRecord{facts:Some(Facts::Video(_)),..},applicability:Applicability::Input(locus_file::api::InputComparison::Matching(current))}) if *current==file)));
    let preview = f
        .media
        .preview(
            &f.kernel,
            &f.files,
            &mut f.session,
            id,
            Rendition { edge: 32 },
        )
        .await
        .unwrap();
    assert_eq!(image::image_dimensions(&preview.path).unwrap(), (32, 20));
    assert_eq!(preview.stream_index, Some(0));
    let unavailable = MediaService::new(
        f.files.root(),
        MediaConfig {
            ffprobe: "certainly-missing-ffprobe".into(),
            ffmpeg: "certainly-missing-ffmpeg".into(),
            ..config
        },
    )
    .unwrap();
    let retried = unavailable
        .interpret(&f.kernel, &f.files, &mut f.session, id)
        .await
        .unwrap();
    assert!(
        matches!(retried,ApplyOutcome::Accepted(MediaRecord{facts:Some(Facts::Video(_)),basis:Some(basis),last_failure:Some(AttemptFailure{code:FailureCode::ToolUnavailable,..}),..}) if basis==file)
    );
    let source = f.files.local_path(&mut f.session, file).await.unwrap();
    let source_path = source.path().to_path_buf();
    drop(source);
    let moved = source_path.with_extension("unavailable");
    std::fs::rename(&source_path, &moved).unwrap();
    assert_eq!(
        unavailable
            .preview(
                &f.kernel,
                &f.files,
                &mut f.session,
                id,
                Rendition { edge: 32 }
            )
            .await
            .unwrap()
            .origin,
        PreviewOrigin::Hit
    );
    f.media.clear_cache().await.unwrap();
    assert!(
        unavailable
            .preview(
                &f.kernel,
                &f.files,
                &mut f.session,
                id,
                Rendition { edge: 32 }
            )
            .await
            .is_err()
    );
    std::fs::rename(&moved, &source_path).unwrap();
    assert_eq!(
        f.media
            .preview(
                &f.kernel,
                &f.files,
                &mut f.session,
                id,
                Rendition { edge: 32 }
            )
            .await
            .unwrap()
            .origin,
        PreviewOrigin::Generated
    );
    assert!(path.is_file());
    assert_eq!(
        f.media
            .read(&mut f.session, id)
            .await
            .unwrap()
            .last_failure
            .unwrap()
            .code,
        FailureCode::ToolUnavailable
    );
    f.media
        .interpret(&f.kernel, &f.files, &mut f.session, id)
        .await
        .unwrap();
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
async fn unsupported_video_input_does_not_invoke_missing_tools() {
    let mut f = Fixture::configured(MediaConfig {
        ffprobe: "missing-probe".into(),
        ..MediaConfig::default()
    })
    .await;
    let (entity, id) = f.component(MediaKind::Video).await;
    let path = f.png("misleading.mp4", 8, 8);
    f.admit(&path, entity).await;
    assert!(matches!(
        f.media
            .interpret(&f.kernel, &f.files, &mut f.session, id)
            .await
            .unwrap(),
        ApplyOutcome::Accepted(MediaRecord {
            facts: None,
            last_failure: Some(AttemptFailure {
                code: FailureCode::UnsupportedInput,
                ..
            }),
            ..
        })
    ));
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires explicit provisioned ffprobe/ffmpeg; run just rust-test-video"]
async fn real_video_matroska_and_temporal_png_movie() {
    let config = tools();
    let mut f = Fixture::configured(config.clone()).await;
    for (filename, codec, container) in [
        ("temporal.mov", "png", "mov"),
        ("temporal.mkv", "ffv1", "matroska"),
    ] {
        let path = f.directory.path().join(filename);
        let output = Command::new(&config.ffmpeg)
            .args([
                "-v",
                "error",
                "-nostdin",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=40x24:r=2:d=1",
                "-c:v",
                codec,
                "-threads",
                "1",
                "-y",
            ])
            .arg(&path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let (entity, id) = f.component(MediaKind::Video).await;
        let file = f.admit(&path, entity).await;
        let initial = f
            .media
            .preview(
                &f.kernel,
                &f.files,
                &mut f.session,
                id,
                Rendition { edge: 18 },
            )
            .await
            .unwrap();
        assert_eq!(initial.origin, PreviewOrigin::Generated);
        assert!(
            f.media
                .read(&mut f.session, id)
                .await
                .unwrap()
                .facts
                .is_none()
        );
        let source = f.files.local_path(&mut f.session, file).await.unwrap();
        let source_path = source.path().to_path_buf();
        drop(source);
        let moved = source_path.with_extension("temporarily-missing");
        std::fs::rename(&source_path, &moved).unwrap();
        let no_tools = MediaService::new(
            f.files.root(),
            MediaConfig {
                ffprobe: "missing-probe".into(),
                ffmpeg: "missing-encoder".into(),
                ..config.clone()
            },
        )
        .unwrap();
        assert_eq!(
            no_tools
                .preview(
                    &f.kernel,
                    &f.files,
                    &mut f.session,
                    id,
                    Rendition { edge: 18 }
                )
                .await
                .unwrap()
                .origin,
            PreviewOrigin::Hit
        );
        std::fs::rename(&moved, &source_path).unwrap();
        let result = f
            .media
            .interpret(&f.kernel, &f.files, &mut f.session, id)
            .await
            .unwrap();
        let ApplyOutcome::Accepted(MediaRecord {
            facts: Some(Facts::Video(facts)),
            ..
        }) = result
        else {
            panic!("{result:?}")
        };
        assert_eq!(facts.container, container);
        assert_eq!(facts.codec.as_deref(), Some(codec));
        assert_eq!(facts.stream_index, 0);
        let cover = f
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
        assert_eq!(image::image_dimensions(cover.path).unwrap(), (20, 12));
        let constrained = MediaService::new(
            f.files.root(),
            MediaConfig {
                max_pixels: 16,
                ..config.clone()
            },
        )
        .unwrap();
        assert!(matches!(
            constrained
                .preview(
                    &f.kernel,
                    &f.files,
                    &mut f.session,
                    id,
                    Rendition { edge: 19 }
                )
                .await,
            Err(MediaError::Attempt(AttemptFailure {
                code: FailureCode::Limit,
                ..
            }))
        ));
        assert!(
            f.media
                .read(&mut f.session, id)
                .await
                .unwrap()
                .last_failure
                .is_none()
        );
    }
}
