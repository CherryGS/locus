#![allow(clippy::expect_used, clippy::unwrap_used)]
use locus_bilibili::api::*;
use locus_core::api::{Kernel, Membership};
use locus_file::api::{FILE_KIND, FileOwner, FileService, InputComparison};
use locus_store::api::Session;
use std::sync::Arc;

fn snapshot(index: u32, role: AssetRole) -> BilibiliSnapshot {
    BilibiliSnapshot {
        bvid: Some("BV145PxzCEoE".into()),
        aid: Some("18446744073709551615".into()),
        page_url: Some(format!(
            "https://www.bilibili.com/video/BV145PxzCEoE/?p={index}"
        )),
        title: Some("A submission".into()),
        description: Some("First line\nSecond line".into()),
        part: Some(PartObservation {
            cid: Some(format!("3653193022{index}")),
            index: Some(index),
            title: Some(format!("Part {index}")),
            ..Default::default()
        }),
        asset_role: Some(role),
        ..Default::default()
    }
}

#[test]
fn locator_and_part_consistency_are_local_and_never_infer_missing_fields() {
    let mut value = BilibiliSnapshot {
        page_url: Some("https://www.bilibili.com/video/BV145PxzCEoE/?p=2".into()),
        description: Some(String::new()),
        ..Default::default()
    };
    value.validate().unwrap();
    assert!(value.bvid.is_none() && value.part.is_none());
    assert_eq!(value.description, Some(String::new()));
    value.bvid = Some("BV1t8411f77Y".into());
    assert!(value.validate().is_err());
    value = snapshot(2, AssetRole::Video);
    value.validate().unwrap();
    value.part.as_mut().unwrap().index = Some(1);
    assert!(value.validate().is_err());
    for url in [
        "https://www.bilibili.com/video/BV145PxzCEoE/?p=1&p=2",
        "https://www.bilibili.com/video/BV145PxzCEoE/?p=0",
        "https://www.bilibili.com/bangumi/play/ep123",
        "https://live.bilibili.com/123",
        "https://www.bilibili.com.evil.example/video/BV145PxzCEoE/",
    ] {
        let mut invalid = snapshot(2, AssetRole::Video);
        invalid.page_url = Some(url.into());
        assert!(invalid.validate().is_err(), "{url}");
    }
    assert!(BilibiliSnapshot::default().validate().is_err());
}

#[tokio::test(flavor = "multi_thread")]
async fn part_and_cover_snapshots_remain_independent_after_replacement_and_reopen() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("metadata.sqlite");
    let mut session = Session::open(&path).await.unwrap();
    let mut kernel = Kernel::new();
    kernel.register(Arc::new(BilibiliOwner)).unwrap();
    kernel.initialize(&mut session).await.unwrap();
    let service = BilibiliService::new();
    service.initialize(&mut session).await.unwrap();
    let first = snapshot(1, AssetRole::Video);
    let second = snapshot(2, AssetRole::Video);
    let cover = snapshot(2, AssetRole::Cover);
    let a = service
        .create(&kernel, &mut session, first.clone())
        .await
        .unwrap();
    let b = service
        .create(&kernel, &mut session, second.clone())
        .await
        .unwrap();
    let c = service
        .create(&kernel, &mut session, cover.clone())
        .await
        .unwrap();
    assert_ne!(a, b);
    assert_ne!(b, c);
    let mut replacement = first;
    replacement.description = Some(String::new());
    assert!(matches!(
        service
            .replace(&mut session, a, 0, replacement.clone())
            .await
            .unwrap(),
        WriteOutcome::Accepted(_)
    ));
    drop(session);
    let mut session = Session::open(&path).await.unwrap();
    service.initialize(&mut session).await.unwrap();
    assert_eq!(
        service.read(&mut session, a).await.unwrap().snapshot,
        replacement
    );
    assert_eq!(
        service.read(&mut session, b).await.unwrap().snapshot,
        second
    );
    assert_eq!(service.read(&mut session, c).await.unwrap().snapshot, cover);
}

#[tokio::test(flavor = "multi_thread")]
async fn file_association_is_guarded_and_replacement_clears_its_basis() {
    let directory = tempfile::tempdir().unwrap();
    let mut session = Session::open(directory.path().join("metadata.sqlite"))
        .await
        .unwrap();
    let files = FileService::new(directory.path().join("library"))
        .await
        .unwrap();
    let mut kernel = Kernel::new();
    kernel.register(Arc::new(FileOwner)).unwrap();
    kernel.register(Arc::new(BilibiliOwner)).unwrap();
    kernel.initialize(&mut session).await.unwrap();
    files.initialize(&mut session).await.unwrap();
    let service = BilibiliService::new();
    service.initialize(&mut session).await.unwrap();
    let capture = snapshot(2, AssetRole::Video);
    let id = service
        .create(&kernel, &mut session, capture.clone())
        .await
        .unwrap();
    let entity = kernel.create_entity(&mut session).await.unwrap();
    kernel
        .attach(
            &mut session,
            Membership {
                entity,
                kind: BILIBILI_KIND,
                component: id.component(),
            },
        )
        .await
        .unwrap();
    let input = directory.path().join("input");
    std::fs::write(&input, b"source association does not claim Media decoding").unwrap();
    let file = files.admit(&kernel, &mut session, input).await.unwrap().id;
    kernel
        .attach(
            &mut session,
            Membership {
                entity,
                kind: FILE_KIND,
                component: file.component(),
            },
        )
        .await
        .unwrap();
    let token = service
        .prepare_association(&kernel, &mut session, id, file)
        .await
        .unwrap();
    service
        .replace(&mut session, id, 0, capture.clone())
        .await
        .unwrap();
    assert_eq!(
        service
            .associate(&kernel, &mut session, token)
            .await
            .unwrap(),
        WriteOutcome::RejectedRevisionChanged
    );
    let token = service
        .prepare_association(&kernel, &mut session, id, file)
        .await
        .unwrap();
    assert!(
        matches!(service.associate(&kernel, &mut session, token).await.unwrap(), WriteOutcome::Accepted(record) if record.basis == Some(file))
    );
    let view = service.view(&kernel, &mut session, id).await.unwrap();
    assert!(
        matches!(view.applicability, BilibiliApplicability::Input { comparison: InputComparison::Matching(found), .. } if found == file)
    );
    assert!(
        service
            .replace(&mut session, id, 2, BilibiliSnapshot::default())
            .await
            .is_err()
    );
    assert_eq!(service.read(&mut session, id).await.unwrap(), view.record);
    service.replace(&mut session, id, 2, capture).await.unwrap();
    assert!(
        service
            .read(&mut session, id)
            .await
            .unwrap()
            .basis
            .is_none()
    );
}
