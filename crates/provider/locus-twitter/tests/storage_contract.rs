#![allow(clippy::expect_used, clippy::unwrap_used)]
mod support;
use locus_core::api::{ComponentId, CoreError};
use locus_store::api::Session;
use locus_twitter::api::*;
use support::*;

#[tokio::test(flavor = "multi_thread")]
async fn reopen_and_unknown_schema_rejection_do_not_repair_data() {
    let mut f = Fixture::new().await;
    let id = f
        .twitter
        .create(&f.kernel, &mut f.session, snapshot())
        .await
        .unwrap();
    let expected = f.twitter.read(&mut f.session, id).await.unwrap();
    f.session = Session::open(&f.database).await.unwrap();
    f.twitter.initialize(&mut f.session).await.unwrap();
    f.twitter.initialize(&mut f.session).await.unwrap();
    assert_eq!(f.twitter.read(&mut f.session, id).await.unwrap(), expected);
    execute(
        &mut f.session,
        "UPDATE locus_twitter_schema SET version=99".into(),
    )
    .await;
    assert!(matches!(
        f.twitter.initialize(&mut f.session).await,
        Err(TwitterError::SchemaVersion(99))
    ));
    assert_eq!(f.twitter.read(&mut f.session, id).await.unwrap(), expected);
    assert_eq!(
        count(
            &mut f.session,
            "SELECT count(*) AS count FROM locus_twitter_schema WHERE version=99"
        )
        .await,
        1
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn corrupt_payload_unknown_version_and_missing_entry_are_distinct() {
    let mut f = Fixture::new().await;
    let (entity, id) = f.component().await;
    let blank = f.kernel.create_entity(&mut f.session).await.unwrap();
    assert!(
        f.twitter
            .entity_view(&f.kernel, &mut f.session, blank)
            .await
            .unwrap()
            .is_none()
    );
    assert!(matches!(
        f.twitter
            .read(
                &mut f.session,
                TwitterId::from_component(ComponentId::new())
            )
            .await,
        Err(TwitterError::MissingRecord(_))
    ));
    for payload in [
        "{}".to_owned(),
        r#"{"version":1,"snapshot":{"post_id":"0"},"basis":null}"#.into(),
        r#"{"version":1,"snapshot":{"post_id":"1","extra":1},"basis":null}"#.into(),
        r#"{"version":1,"snapshot":{"post_id":"1"},"basis":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}"#
            .into(),
        "x".repeat(MAX_PAYLOAD_BYTES + 1),
    ] {
        execute(
            &mut f.session,
            format!("UPDATE locus_twitter_snapshots SET payload='{payload}'"),
        )
        .await;
        assert!(matches!(
            f.twitter.read(&mut f.session, id).await,
            Err(TwitterError::Corrupt(_))
        ));
        let entry = f
            .twitter
            .entity_view(&f.kernel, &mut f.session, entity)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(entry.membership, membership(entity, id));
        assert!(matches!(entry.result, Err(TwitterError::Corrupt(_))));
    }
    execute(
        &mut f.session,
        r#"UPDATE locus_twitter_snapshots SET payload='{"version":2,"future":true}'"#.into(),
    )
    .await;
    assert!(matches!(
        f.twitter.read(&mut f.session, id).await,
        Err(TwitterError::PayloadVersion(2))
    ));
    execute(&mut f.session, "DELETE FROM locus_twitter_snapshots".into()).await;
    let entry = f
        .twitter
        .entity_view(&f.kernel, &mut f.session, entity)
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(entry.result,Err(TwitterError::MissingRecord(v)) if v==id));
}

#[tokio::test(flavor = "multi_thread")]
async fn per_kind_membership_and_guarded_deletion_are_isolated() {
    let mut f = Fixture::new().await;
    let (entity, id) = f.component().await;
    let second = f
        .twitter
        .create(&f.kernel, &mut f.session, snapshot())
        .await
        .unwrap();
    let file = f.file(entity, "input").await;
    let record = f.associate(id, file).await;
    assert!(matches!(
        f.kernel
            .attach(&mut f.session, membership(entity, second))
            .await,
        Err(CoreError::SlotOccupied(_))
    ));
    let other = f.kernel.create_entity(&mut f.session).await.unwrap();
    assert!(matches!(
        f.kernel.attach(&mut f.session, membership(other, id)).await,
        Err(CoreError::AttachmentOccupied(_))
    ));
    assert!(matches!(
        f.kernel
            .delete_component(&mut f.session, TWITTER_KIND, id.component())
            .await,
        Err(CoreError::ComponentAttached(_))
    ));
    f.kernel
        .delete_entity(&mut f.session, entity)
        .await
        .unwrap();
    assert_eq!(f.twitter.read(&mut f.session, id).await.unwrap(), record);
    f.kernel
        .delete_component(&mut f.session, TWITTER_KIND, id.component())
        .await
        .unwrap();
    assert!(matches!(
        f.twitter.read(&mut f.session, id).await,
        Err(TwitterError::MissingRecord(_))
    ));
    assert!(f.twitter.read(&mut f.session, second).await.is_ok());
    assert!(f.files.open(&mut f.session, file).await.is_ok());
    assert!(f.directory.path().join("input").is_file());
}
