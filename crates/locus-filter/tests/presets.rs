#![allow(clippy::expect_used, clippy::unwrap_used)]
use locus_filter::api::{FilterError, FilterService as F, native_source};
use locus_store::api::Session;
#[tokio::test(flavor = "multi_thread")]
async fn exact_invalid_source_guarded_identity_and_persistence_without_an_index() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("db.sqlite");
    let mut s = Session::open(&path).await.unwrap();
    locus_migration::api::migrate(&mut s).await.unwrap();
    let source = native_source("@name(\"中文\", unfinished\r\n18446744073709551615");
    let text = source.clone();
    let saved = s
        .transaction(move |c| Box::pin(async move { F::create_in(c, "  Alpha  ", source).await }))
        .await
        .unwrap();
    assert_eq!(saved.name, "Alpha");
    assert_eq!(saved.source, text);
    let original = saved.clone();
    let renamed = s
        .transaction(move |c| {
            Box::pin(async move { F::rename_in(c, &original.id, &original.revision, "Beta").await })
        })
        .await
        .unwrap();
    let stale = saved.clone();
    assert!(matches!(
        s.transaction(move |c| Box::pin(async move {
            F::update_in(c, &stale.id, &stale.revision, "ignored", native_source("*")).await
        }))
        .await,
        Err(FilterError::Conflict)
    ));
    assert!(matches!(
        s.transaction(|c| Box::pin(
            async move { F::create_in(c, "Beta", native_source("")).await }
        ))
        .await,
        Err(FilterError::DuplicateName)
    ));
    s.transaction(|c| Box::pin(async move { F::create_in(c, "beta", native_source("")).await }))
        .await
        .unwrap();
    let id = renamed.id.clone();
    let copy = s
        .transaction(move |c| Box::pin(async move { F::copy_in(c, &id, "Copy").await }))
        .await
        .unwrap();
    assert_ne!(copy.id, renamed.id);
    assert_eq!(copy.source, text);
    let deleted = renamed.clone();
    s.transaction(move |c| {
        Box::pin(async move { F::delete_in(c, &deleted.id, &deleted.revision).await })
    })
    .await
    .unwrap();
    assert!(matches!(
        s.transaction(move |c| Box::pin(async move {
            F::rename_in(c, &renamed.id, &renamed.revision, "Revive").await
        }))
        .await,
        Err(FilterError::Absent)
    ));
    drop(s);
    let mut s = Session::open(&path).await.unwrap();
    locus_migration::api::migrate(&mut s).await.unwrap();
    let id = copy.id;
    assert_eq!(
        s.transaction(move |c| Box::pin(async move { F::read_in(c, &id).await }))
            .await
            .unwrap()
            .source,
        text
    );
    let mut unsupported = native_source("original bytes");
    unsupported.format = "future-profile".into();
    unsupported.version = 99;
    let record = s
        .transaction(move |c| Box::pin(async move { F::create_in(c, "Future", unsupported).await }))
        .await
        .unwrap();
    assert!(locus_filter::api::compile(record.source).is_err());
}
