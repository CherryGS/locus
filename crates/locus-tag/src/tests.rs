#![allow(clippy::expect_used, clippy::unwrap_used)]
use crate::{
    error::TagError,
    identity::{TAG_SET_KIND, TagId},
    owner::TagSetOwner,
    service::TagService,
};
use diesel::{QueryableByName, sql_query, sql_types::BigInt};
use diesel_async::RunQueryDsl;
use locus_core::api::{EntityId, Kernel, Membership};
use locus_store::api::{Context, Session};
use std::sync::Arc;
async fn setup() -> (tempfile::TempDir, Session, Kernel) {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::open(dir.path().join("metadata.sqlite"))
        .await
        .unwrap();
    locus_migration::api::migrate(&mut s).await.unwrap();
    let mut k = Kernel::new();
    k.register(Arc::new(TagSetOwner)).unwrap();
    (dir, s, k)
}
#[derive(QueryableByName)]
struct Count {
    #[diesel(sql_type=BigInt)]
    n: i64,
}
async fn count(c: &mut Context, table: &str) -> i64 {
    sql_query(format!("SELECT count(*) AS n FROM {table}"))
        .get_result::<Count>(c.connection())
        .await
        .unwrap()
        .n
}
#[tokio::test(flavor = "multi_thread")]
async fn vocabulary_guards_deltas_retention_and_global_cleanup() {
    let (_d, mut s, k) = setup().await;
    s.transaction(move |c| {
        Box::pin(async move {
            let a = k.create_entity_in(c).await?;
            let b = k.create_entity_in(c).await?;
            assert!(TagService::entity_in(&k, c, a).await?.is_none());
            let cat = TagService::create_in(c, "  cat \n").await?;
            assert_eq!(cat.name, "cat");
            let upper = TagService::create_in(c, "Cat").await?;
            assert_eq!(count(c, "locus_core_comm_entity").await, 2);
            assert!(matches!(
                TagService::create_in(c, "cat").await,
                Err(TagError::DuplicateName)
            ));
            assert!(matches!(
                TagService::create_in(c, "  ").await,
                Err(TagError::BlankName)
            ));
            assert!(TagService::add_in(&k, c, a, cat.id).await?);
            assert!(!TagService::add_in(&k, c, a, cat.id).await?);
            assert!(TagService::add_in(&k, c, a, upper.id).await?);
            assert!(TagService::add_in(&k, c, b, cat.id).await?);
            let aset = TagService::entity_in(&k, c, a).await?.unwrap();
            let bset = TagService::entity_in(&k, c, b).await?.unwrap();
            assert_ne!(aset.id, bset.id);
            assert!(TagService::remove_in(&k, c, a, cat.id).await?);
            assert!(!TagService::remove_in(&k, c, a, cat.id).await?);
            assert_eq!(
                TagService::entity_in(&k, c, b).await?.unwrap().tags.len(),
                1
            );
            let renamed = TagService::rename_in(c, cat.id, &cat.revision, "kitten").await?;
            assert_eq!(renamed.id, cat.id);
            assert!(matches!(
                TagService::delete_in(c, cat.id, &cat.revision).await,
                Err(TagError::Conflict)
            ));
            assert!(matches!(
                TagService::rename_in(c, cat.id, &renamed.revision, "Cat").await,
                Err(TagError::DuplicateName)
            ));
            let before_delete = count(c, "locus_search_comm_invalidation").await;
            let doomed = renamed.clone();
            let rollback = c
                .savepoint(move |c| {
                    Box::pin(async move {
                        TagService::delete_in(c, doomed.id, &doomed.revision).await?;
                        Err::<(), _>(TagError::Conflict)
                    })
                })
                .await;
            assert!(rollback.is_err());
            assert_eq!(
                count(c, "locus_search_comm_invalidation").await,
                before_delete
            );
            assert_eq!(
                TagService::entity_in(&k, c, b).await?.unwrap().tags[0].id,
                cat.id
            );
            k.detach_in(
                c,
                Membership {
                    entity: b,
                    kind: TAG_SET_KIND,
                    component: bset.id,
                },
            )
            .await?;
            assert!(TagService::entity_in(&k, c, b).await?.is_none());
            assert_eq!(
                TagService::read_set_in(c, bset.id).await?.tags[0].name,
                "kitten"
            );
            TagService::delete_in(c, cat.id, &renamed.revision).await?;
            assert!(TagService::read_set_in(c, bset.id).await?.tags.is_empty());
            assert_eq!(
                TagService::entity_in(&k, c, a).await?.unwrap().tags[0].id,
                upper.id
            );
            k.delete_component_in(c, TAG_SET_KIND, bset.id).await?;
            assert!(TagService::read_in(c, upper.id).await.is_ok());
            assert_eq!(count(c, "locus_core_comm_entity").await, 2);
            let replacement = TagService::create_in(c, "kitten").await?;
            assert_ne!(replacement.id, cat.id);
            assert!(TagService::remove_in(&k, c, a, upper.id).await?);
            assert!(
                TagService::entity_in(&k, c, a)
                    .await?
                    .unwrap()
                    .tags
                    .is_empty()
            );
            k.delete_entity_in(c, a).await?;
            assert!(TagService::read_set_in(c, aset.id).await?.tags.is_empty());
            Ok::<_, TagError>(())
        })
    })
    .await
    .unwrap();
}
#[tokio::test(flavor = "multi_thread")]
async fn first_set_failure_and_journal_rollback_are_atomic() {
    let (_d, mut s, k) = setup().await;
    let a = k.create_entity(&mut s).await.unwrap();
    let kc = k.clone();
    let tag = s
        .transaction(move |c| {
            Box::pin(async move {
                let t = TagService::create_in(c, "one").await?;
                assert!(matches!(
                    TagService::add_in(&kc, c, EntityId::new(), t.id).await,
                    Err(TagError::Core(_))
                ));
                assert!(matches!(
                    TagService::add_in(&kc, c, a, TagId::new()).await,
                    Err(TagError::MissingTag)
                ));
                assert_eq!(count(c, "locus_tag_comp_set").await, 0);
                // A caller may catch first-set admission failure and still commit unrelated work.
                let unregistered = Kernel::new();
                assert!(TagService::add_in(&unregistered, c, a, t.id).await.is_err());
                assert_eq!(count(c, "locus_tag_comp_set").await, 0);
                Ok::<_, TagError>(t)
            })
        })
        .await
        .unwrap();
    let before = s
        .transaction(|c| {
            Box::pin(
                async move { Ok::<_, TagError>(count(c, "locus_search_comm_invalidation").await) },
            )
        })
        .await
        .unwrap();
    let id = tag.id;
    let kc = k.clone();
    let failed = s
        .transaction(move |c| {
            Box::pin(async move {
                TagService::add_in(&kc, c, a, id).await?;
                TagService::rename_in(c, id, &tag.revision, "two").await?;
                Err::<(), _>(TagError::Conflict)
            })
        })
        .await;
    assert!(failed.is_err());
    s.transaction(move |c| {
        Box::pin(async move {
            assert_eq!(count(c, "locus_search_comm_invalidation").await, before);
            assert!(TagService::entity_in(&k, c, a).await?.is_none());
            assert_eq!(TagService::read_in(c, id).await?.name, "one");
            Ok::<_, TagError>(())
        })
    })
    .await
    .unwrap();
}
#[tokio::test(flavor = "multi_thread")]
async fn concurrent_add_delete_reopen_and_cascade_invalidation() {
    let (dir, mut s, k) = setup().await;
    let a = k.create_entity(&mut s).await.unwrap();
    let b = k.create_entity(&mut s).await.unwrap();
    let kc = k.clone();
    let tag = s
        .transaction(move |c| {
            Box::pin(async move {
                let t = TagService::create_in(c, "shared").await?;
                TagService::add_in(&kc, c, a, t.id).await?;
                Ok::<_, TagError>(t)
            })
        })
        .await
        .unwrap();
    let id = tag.id;
    let kc = k.clone();
    let mut other = Session::open(dir.path().join("metadata.sqlite"))
        .await
        .unwrap();
    let (added, deleted) = tokio::join!(
        s.transaction(move |c| Box::pin(async move { TagService::add_in(&kc, c, b, id).await })),
        other.transaction(move |c| Box::pin(async move {
            TagService::delete_in(c, id, &tag.revision).await
        }))
    );
    assert!(added.is_ok() || matches!(added, Err(TagError::MissingTag)));
    deleted.unwrap();
    drop(s);
    drop(other);
    let mut s = Session::open(dir.path().join("metadata.sqlite"))
        .await
        .unwrap();
    s.transaction(move |c| {
        Box::pin(async move {
            assert_eq!(count(c, "locus_tag_rela_assignment").await, 0);
            assert!(
                TagService::entity_in(&k, c, a)
                    .await?
                    .unwrap()
                    .tags
                    .is_empty()
            );
            assert!(k.entity_exists_in(c, a).await?);
            assert!(k.entity_exists_in(c, b).await?);
            assert!(count(c, "locus_search_comm_invalidation").await >= 5);
            Ok::<_, TagError>(())
        })
    })
    .await
    .unwrap();
}
