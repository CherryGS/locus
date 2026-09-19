#![allow(clippy::expect_used, clippy::unwrap_used)]
mod support;
use locus_core::api::Membership;
use locus_file::api::InputComparison;
use locus_media::api::{ApplyOutcome, ImageOwner, MediaConfig, MediaService, VideoOwner};
use locus_twitter::api::*;
use std::sync::Arc;
use support::*;

#[tokio::test(flavor = "multi_thread")]
async fn image_video_and_source_keep_independent_bases_and_diagnostics() {
    let mut f = Fixture::new().await;
    f.kernel.register(Arc::new(ImageOwner)).unwrap();
    f.kernel.register(Arc::new(VideoOwner)).unwrap();
    let media = MediaService::new(
        f.files.root(),
        MediaConfig {
            ffprobe: f.directory.path().join("missing-ffprobe"),
            ..Default::default()
        },
    )
    .unwrap();
    media.initialize(&mut f.session).await.unwrap();
    let (entity, id) = f.component().await;
    let (video_entity, video_source) = f.component().await;
    let first = f.file(entity, "not-image").await;
    let video_file = f.file(video_entity, "not-video").await;
    let source_record = f.associate(id, first).await;
    let video_source_record = f.associate(video_source, video_file).await;
    let image = media.create_image(&f.kernel, &mut f.session).await.unwrap();
    let video = media.create_video(&f.kernel, &mut f.session).await.unwrap();
    f.kernel
        .attach(
            &mut f.session,
            Membership {
                entity,
                kind: locus_media::api::IMAGE_KIND,
                component: image.component(),
            },
        )
        .await
        .unwrap();
    let video_membership = Membership {
        entity: video_entity,
        kind: locus_media::api::VIDEO_KIND,
        component: video.component(),
    };
    f.kernel
        .attach(&mut f.session, video_membership)
        .await
        .unwrap();
    assert!(matches!(
        media
            .interpret(&f.kernel, &f.files, &mut f.session, video)
            .await
            .unwrap(),
        ApplyOutcome::Accepted(locus_media::api::MediaRecord {
            facts: None,
            last_failure: Some(_),
            basis: None,
            ..
        })
    ));
    assert_eq!(
        f.twitter.read(&mut f.session, video_source).await.unwrap(),
        video_source_record
    );
    f.kernel
        .detach(&mut f.session, video_membership)
        .await
        .unwrap();
    assert_eq!(
        f.twitter.read(&mut f.session, video_source).await.unwrap(),
        video_source_record
    );
    f.kernel
        .detach(&mut f.session, file_membership(entity, first))
        .await
        .unwrap();
    let path = f.directory.path().join("real.png");
    image::RgbaImage::from_pixel(4, 3, image::Rgba([1, 2, 3, 255]))
        .save(&path)
        .unwrap();
    let second = f
        .files
        .admit(&f.kernel, &mut f.session, &path)
        .await
        .unwrap()
        .id;
    f.kernel
        .attach(&mut f.session, file_membership(entity, second))
        .await
        .unwrap();
    assert!(
        matches!(media.interpret(&f.kernel,&f.files,&mut f.session,image).await.unwrap(),ApplyOutcome::Accepted(locus_media::api::MediaRecord {facts:Some(_),basis:Some(v),..}) if v==second)
    );
    assert_eq!(
        f.twitter.read(&mut f.session, id).await.unwrap(),
        source_record
    );
    assert!(
        matches!(f.twitter.view(&f.kernel,&mut f.session,id).await.unwrap().applicability,TwitterApplicability::Input {comparison:InputComparison::Changed {basis,current},..} if basis==first && current==second)
    );
    let image_record = media.read(&mut f.session, image).await.unwrap();
    let mut replacement = snapshot();
    replacement.occurrence = Some(MediaOccurrence {
        label: Some(MediaLabel::AnimatedImage),
        claims: Some(MediaClaims {
            width: Some(1920),
            ..Default::default()
        }),
        ..Default::default()
    });
    f.twitter
        .replace(&mut f.session, id, source_record.revision, replacement)
        .await
        .unwrap();
    assert_eq!(
        media.read(&mut f.session, image).await.unwrap(),
        image_record
    );
    assert_eq!(
        f.twitter.read(&mut f.session, video_source).await.unwrap(),
        video_source_record
    );
    assert_ne!(id, video_source);
    assert_eq!(
        f.kernel
            .component_kind(&mut f.session, id.component())
            .await
            .unwrap(),
        f.kernel
            .component_kind(&mut f.session, video_source.component())
            .await
            .unwrap()
    );
}
