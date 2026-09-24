#![allow(clippy::expect_used, clippy::unwrap_used)]
mod support;
use locus_bilibili::api::*;
use locus_file::api::{CurrentInput, InputComparison};
use locus_store::api::Session;
use support::*;

#[tokio::test(flavor = "multi_thread")]
async fn independent_qualified_cover_replacement_reopen_and_missing_target() {
    let mut f = Fixture::new().await;
    let (main, id) = f.component().await;
    let (_, other) = f.component().await;
    let main_file = f.file(main, "main").await;
    f.associate(id, main_file).await;
    let cover = f.kernel.create_entity(&mut f.session).await.unwrap();
    let cover_file = f.file(cover, "cover").await;
    let prepared = f
        .bilibili
        .prepare_cover(
            &f.kernel,
            &mut f.session,
            id,
            OriginalCover {
                entity: cover,
                file: cover_file,
            },
        )
        .await
        .unwrap();
    f.bilibili
        .associate_cover(&f.kernel, &mut f.session, prepared)
        .await
        .unwrap();
    assert!(
        f.bilibili
            .read(&mut f.session, other)
            .await
            .unwrap()
            .original_cover
            .is_none()
    );
    f.session = Session::open(&f.database).await.unwrap();
    let view = f
        .bilibili
        .view(&f.kernel, &mut f.session, id)
        .await
        .unwrap();
    assert!(
        matches!(view.applicability,BilibiliApplicability::Input{comparison:InputComparison::Matching(v),..} if v==main_file)
    );
    assert!(
        matches!(view.cover,CoverApplicability::Input{comparison:InputComparison::Matching(v),..} if v==cover_file)
    );
    f.kernel
        .detach(&mut f.session, file_membership(cover, cover_file))
        .await
        .unwrap();
    let view = f
        .bilibili
        .view(&f.kernel, &mut f.session, id)
        .await
        .unwrap();
    assert_eq!(
        view.record.original_cover,
        Some(OriginalCover {
            entity: cover,
            file: cover_file
        })
    );
    assert!(matches!(
        view.cover,
        CoverApplicability::Input {
            comparison: InputComparison::Incomplete {
                current: CurrentInput::MissingSlot(_),
                ..
            },
            ..
        }
    ));
    let replacement = f.file(cover, "new-cover").await;
    let view = f
        .bilibili
        .view(&f.kernel, &mut f.session, id)
        .await
        .unwrap();
    assert!(
        matches!(view.cover,CoverApplicability::Input{comparison:InputComparison::Changed{basis,current},..} if basis==cover_file && current==replacement)
    );
    let revision = view.record.revision;
    f.bilibili
        .replace(&mut f.session, id, revision, snapshot())
        .await
        .unwrap();
    let r = f.bilibili.read(&mut f.session, id).await.unwrap();
    assert!(r.original_cover.is_none());
    assert!(r.basis.is_none());
    assert!(f.files.read(&mut f.session, cover_file).await.is_ok());
}
#[tokio::test(flavor = "multi_thread")]
async fn cover_revision_and_context_guards_preserve_whole_snapshot() {
    let mut f = Fixture::new().await;
    let (_, id) = f.component().await;
    let cover = f.kernel.create_entity(&mut f.session).await.unwrap();
    let file = f.file(cover, "cover").await;
    let first = f
        .bilibili
        .prepare_cover(
            &f.kernel,
            &mut f.session,
            id,
            OriginalCover {
                entity: cover,
                file,
            },
        )
        .await
        .unwrap();
    f.bilibili
        .replace(&mut f.session, id, 0, snapshot())
        .await
        .unwrap();
    assert_eq!(
        f.bilibili
            .associate_cover(&f.kernel, &mut f.session, first)
            .await
            .unwrap(),
        WriteOutcome::RejectedRevisionChanged
    );
    let prepared = f
        .bilibili
        .prepare_cover(
            &f.kernel,
            &mut f.session,
            id,
            OriginalCover {
                entity: cover,
                file,
            },
        )
        .await
        .unwrap();
    f.kernel
        .detach(&mut f.session, file_membership(cover, file))
        .await
        .unwrap();
    assert_eq!(
        f.bilibili
            .associate_cover(&f.kernel, &mut f.session, prepared)
            .await
            .unwrap(),
        WriteOutcome::RejectedContextChanged
    );
    let before = f.bilibili.read(&mut f.session, id).await.unwrap();
    let invalid = BilibiliSnapshot {
        page_url: Some("https://example.com/video/BV1xx411c7mD".into()),
        ..Default::default()
    };
    assert!(
        f.bilibili
            .replace(&mut f.session, id, before.revision, invalid)
            .await
            .is_err()
    );
    assert_eq!(before, f.bilibili.read(&mut f.session, id).await.unwrap());
}
#[test]
fn locator_and_partial_observations() {
    for v in [
        BilibiliSnapshot {
            bvid: Some("BV1xx411c7mD".into()),
            title: Some(String::new()),
            tags: Some(vec![]),
            ..Default::default()
        },
        BilibiliSnapshot {
            aid: Some("123".into()),
            ..Default::default()
        },
        BilibiliSnapshot {
            page_url: Some("https://www.bilibili.com/video/BV1xx411c7mD?p=2".into()),
            ..Default::default()
        },
    ] {
        assert!(v.validate().is_ok());
    }
    for url in [
        "https://www.bilibili.com/video/not-an-id",
        "https://bilibili.com/video/av0",
        "https://bilibili.com/video/BV1xx411c7mD?p=0",
    ] {
        assert!(
            BilibiliSnapshot {
                page_url: Some(url.into()),
                ..Default::default()
            }
            .validate()
            .is_err()
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn explicit_cover_carry_forward_and_caught_write_failure_preserve_atomic_state() {
    use diesel_async::SimpleAsyncConnection;
    let mut f = Fixture::new().await;
    let (main, id) = f.component().await;
    let main_file = f.file(main, "main").await;
    f.associate(id, main_file).await;
    let cover = f.kernel.create_entity(&mut f.session).await.unwrap();
    let file = f.file(cover, "cover").await;
    let relation = OriginalCover {
        entity: cover,
        file,
    };
    let prepared = f
        .bilibili
        .prepare_cover(&f.kernel, &mut f.session, id, relation)
        .await
        .unwrap();
    f.bilibili
        .associate_cover(&f.kernel, &mut f.session, prepared)
        .await
        .unwrap();
    let before = f.bilibili.read(&mut f.session, id).await.unwrap();
    let prepared = f
        .bilibili
        .prepare_cover(&f.kernel, &mut f.session, id, relation)
        .await
        .unwrap();
    let invalid = BilibiliSnapshot {
        bvid: Some("invalid".into()),
        ..Default::default()
    };
    assert!(
        f.bilibili
            .replace_with_cover(&f.kernel, &mut f.session, prepared, invalid)
            .await
            .is_err()
    );
    assert_eq!(f.bilibili.read(&mut f.session, id).await.unwrap(), before);
    let prepared = f
        .bilibili
        .prepare_cover(&f.kernel, &mut f.session, id, relation)
        .await
        .unwrap();
    let changed = BilibiliSnapshot {
        title: Some("Replacement".into()),
        ..snapshot()
    };
    f.bilibili
        .replace_with_cover(&f.kernel, &mut f.session, prepared, changed.clone())
        .await
        .unwrap();
    let accepted = f.bilibili.read(&mut f.session, id).await.unwrap();
    assert_eq!(accepted.original_cover, Some(relation));
    assert!(accepted.basis.is_none());
    assert_eq!(accepted.snapshot, changed);
    execute(&mut f.session,"CREATE TRIGGER fail_bilibili AFTER UPDATE ON locus_bilibili_snapshots BEGIN SELECT RAISE(FAIL,'test: participant failure'); END;".into()).await;
    let kernel = f.kernel.clone();
    f.session.transaction::<_,BilibiliError,_>(move|c|Box::pin(async move{
   let token=BilibiliService::prepare_cover_in(&kernel,c,id,relation).await?;
   assert!(BilibiliService::replace_with_cover_in(&kernel,c,token,snapshot()).await.is_err());
   c.connection().batch_execute("CREATE TABLE independent_commit (value INTEGER); INSERT INTO independent_commit VALUES (1);").await?;
   Ok(())
 })).await.unwrap();
    assert_eq!(f.bilibili.read(&mut f.session, id).await.unwrap(), accepted);
    assert_eq!(
        count(
            &mut f.session,
            "SELECT count(*) AS count FROM independent_commit"
        )
        .await,
        1
    );
}
