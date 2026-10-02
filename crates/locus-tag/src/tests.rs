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
#[tokio::test(flavor = "multi_thread")]
async fn markdown_is_verbatim_guarded_retained_and_deleted_with_its_tag() {
    let (dir, mut s, k) = setup().await;
    let (parent, child, entity, markdown) = s
        .transaction(move |c| {
            Box::pin(async move {
                let root = TagService::create_in(c, "root").await?;
                let child = TagService::create_under_in(c, "child", Some(root.id)).await?;
                assert_eq!(
                    TagService::read_document_in(c, child.id).await?.markdown,
                    ""
                );
                assert!(matches!(
                    TagService::read_document_in(c, TagId::new()).await,
                    Err(TagError::MissingTag)
                ));
                let entity = k.create_entity_in(c).await?;
                TagService::add_in(&k, c, entity, child.id).await?;
                let before_journal = count(c, "locus_search_comm_invalidation").await;
                let markdown =
                    "  # 中文\r\n\r\n| a | b |\n| - | - |\n\n```rust\nlet x = 1;\n```\n\n  "
                        .to_owned();
                let saved =
                    TagService::save_markdown_in(c, child.id, &child.revision, &markdown).await?;
                assert_ne!(saved.revision, child.revision);
                assert_eq!(saved.id, child.id);
                assert_eq!(saved.name, child.name);
                assert_eq!(saved.parent, child.parent);
                assert_eq!(
                    TagService::read_document_in(c, child.id).await?.markdown,
                    markdown
                );
                assert_eq!(
                    TagService::save_markdown_in(c, child.id, &saved.revision, &markdown).await?,
                    saved
                );
                assert!(matches!(
                    TagService::save_markdown_in(c, child.id, &child.revision, &markdown).await,
                    Err(TagError::Conflict)
                ));
                assert_eq!(
                    count(c, "locus_search_comm_invalidation").await,
                    before_journal
                );
                assert_eq!(
                    TagService::entity_in(&k, c, entity).await?.unwrap().tags[0],
                    saved
                );
                let renamed =
                    TagService::rename_in(c, child.id, &saved.revision, "renamed").await?;
                assert!(matches!(
                    TagService::save_markdown_in(c, child.id, &saved.revision, "obsolete").await,
                    Err(TagError::Conflict)
                ));
                let other = TagService::create_in(c, "other").await?;
                let moved =
                    TagService::move_in(c, child.id, &renamed.revision, Some(other.id)).await?;
                assert!(matches!(
                    TagService::save_markdown_in(c, child.id, &renamed.revision, "obsolete").await,
                    Err(TagError::Conflict)
                ));
                let parent =
                    TagService::save_markdown_in(c, other.id, &other.revision, "parent document")
                        .await?;
                assert_eq!(
                    TagService::read_document_in(c, child.id).await?.markdown,
                    markdown
                );
                Ok::<_, TagError>((parent, moved, entity, markdown))
            })
        })
        .await
        .unwrap();
    drop(s);
    let mut s = Session::open(dir.path().join("metadata.sqlite"))
        .await
        .unwrap();
    s.transaction(move |c| {
        Box::pin(async move {
            let document = TagService::read_document_in(c, child.id).await?;
            assert_eq!(document.tag, child);
            assert_eq!(document.markdown, markdown);
            TagService::delete_in(c, parent.id, &parent.revision).await?;
            assert!(matches!(
                TagService::read_document_in(c, parent.id).await,
                Err(TagError::MissingTag)
            ));
            assert!(matches!(
                TagService::save_markdown_in(c, parent.id, &parent.revision, "revive").await,
                Err(TagError::MissingTag)
            ));
            let surviving = TagService::read_document_in(c, child.id).await?;
            assert_eq!(surviving.markdown, markdown);
            assert_eq!(surviving.tag.parent, None);
            assert_ne!(surviving.tag.revision, child.revision);
            let k = Kernel::new();
            assert!(k.entity_exists_in(c, entity).await?);
            TagService::delete_in(c, child.id, &surviving.tag.revision).await?;
            assert!(matches!(
                TagService::read_document_in(c, child.id).await,
                Err(TagError::MissingTag)
            ));
            assert_eq!(count(c, "locus_tag_rela_assignment").await, 0);
            Ok::<_, TagError>(())
        })
    })
    .await
    .unwrap();
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
async fn forest_moves_promotion_direct_annotations_and_failed_delete_participant() {
    use diesel_async::SimpleAsyncConnection;
    let (_d, mut s, k) = setup().await;
    s.transaction(move |c| Box::pin(async move {
        let root = TagService::create_in(c, "root").await?;
        let middle = TagService::create_under_in(c, "middle", Some(root.id)).await?;
        let leaf = TagService::create_under_in(c, "leaf", Some(middle.id)).await?;
        let other = TagService::create_in(c, "other").await?;
        assert_eq!(TagService::subtree_in(c, root.id).await?.len(), 3);
        assert!(matches!(TagService::create_under_in(c, "leaf", Some(other.id)).await, Err(TagError::DuplicateName)));
        assert!(matches!(TagService::create_under_in(c, "missing", Some(TagId::new())).await, Err(TagError::MissingTag)));
        assert!(matches!(TagService::move_in(c, root.id, &root.revision, Some(leaf.id)).await, Err(TagError::InvalidParent)));
        assert!(matches!(TagService::move_in(c, root.id, &root.revision, Some(root.id)).await, Err(TagError::InvalidParent)));
        assert!(matches!(TagService::move_in(c, root.id, &root.revision, Some(TagId::new())).await, Err(TagError::MissingTag)));
        let entity = k.create_entity_in(c).await?;
        TagService::add_in(&k, c, entity, leaf.id).await?;
        let journal = count(c, "locus_search_comm_invalidation").await;
        let moved = TagService::move_in(c, middle.id, &middle.revision, Some(other.id)).await?;
        assert_ne!(moved.revision, middle.revision);
        assert_eq!(TagService::move_in(c, middle.id, &moved.revision, Some(other.id)).await?, moved);
        assert_eq!(count(c, "locus_search_comm_invalidation").await, journal);
        assert_eq!(TagService::subtree_in(c, root.id).await?, vec![root.id]);
        assert_eq!(TagService::entity_in(&k, c, entity).await?.unwrap().tags.iter().map(|t| t.id).collect::<Vec<_>>(), vec![leaf.id]);
        assert!(matches!(TagService::move_in(c, middle.id, &middle.revision, None).await, Err(TagError::Conflict)));
        // Force failure after promotion. Catching it must not commit the child revision or parent.
        c.connection().batch_execute("CREATE TRIGGER fixture_delete_failure BEFORE DELETE ON locus_tag_comm_tag BEGIN SELECT RAISE(ABORT,'fixture failure'); END").await?;
        assert!(TagService::delete_in(c, middle.id, &moved.revision).await.is_err());
        assert_eq!(TagService::read_in(c, leaf.id).await?, leaf);
        c.connection().batch_execute("DROP TRIGGER fixture_delete_failure").await?;
        TagService::delete_in(c, middle.id, &moved.revision).await?;
        let promoted = TagService::read_in(c, leaf.id).await?;
        assert_eq!(promoted.parent, Some(other.id));
        assert_ne!(promoted.revision, leaf.revision);
        assert!(matches!(TagService::rename_in(c, leaf.id, &leaf.revision, "obsolete").await, Err(TagError::Conflict)));
        TagService::delete_in(c, other.id, &other.revision).await?;
        assert_eq!(TagService::read_in(c, leaf.id).await?.parent, None);
        assert_eq!(TagService::entity_in(&k, c, entity).await?.unwrap().tags[0].id, leaf.id);
        assert!(matches!(TagService::subtree_in(c, other.id).await, Err(TagError::MissingTag)));
        Ok::<_, TagError>(())
    })).await.unwrap();
}
#[tokio::test(flavor = "multi_thread")]
async fn malformed_cycle_is_an_error_for_forest_record_and_resolution() {
    let (_d, mut s, _) = setup().await;
    s.transaction(|c| {
        Box::pin(async move {
            let root = TagService::create_in(c, "root").await?;
            let child = TagService::create_under_in(c, "child", Some(root.id)).await?;
            sql_query("UPDATE locus_tag_comm_tag SET parent=? WHERE id=?")
                .bind::<diesel::sql_types::Binary, _>(child.id.as_bytes().as_slice())
                .bind::<diesel::sql_types::Binary, _>(root.id.as_bytes().as_slice())
                .execute(c.connection())
                .await?;
            assert!(matches!(
                TagService::list_in(c).await,
                Err(TagError::Corrupt(_))
            ));
            assert!(matches!(
                TagService::read_in(c, root.id).await,
                Err(TagError::Corrupt(_))
            ));
            assert!(matches!(
                TagService::subtree_in(c, root.id).await,
                Err(TagError::Corrupt(_))
            ));
            Ok::<_, TagError>(())
        })
    })
    .await
    .unwrap();
}
#[tokio::test(flavor = "multi_thread")]
async fn deep_forest_traversal_is_iterative_and_measured() {
    use diesel_async::SimpleAsyncConnection;
    let (_d, mut s, _) = setup().await;
    s.transaction(|c| Box::pin(async move {
        let ids: Vec<_> = (0..2000).map(|_| TagId::new()).collect();
        let hex = |id: TagId| id.as_bytes().iter().map(|b| format!("{b:02x}")).collect::<String>();
        let revision = uuid::Uuid::now_v7().to_string();
        let mut statements = String::new();
        for (i, id) in ids.iter().enumerate() {
            let parent = if i == 0 { "NULL".into() } else { format!("X'{}'", hex(ids[i-1])) };
            statements.push_str(&format!("INSERT INTO locus_tag_comm_tag(id,name,revision,parent) VALUES(X'{}','node-{i}','{revision}',{parent});", hex(*id)));
        }
        c.connection().batch_execute(&statements).await?;
        let start = std::time::Instant::now();
        let all = TagService::subtree_in(c, ids[0]).await?;
        assert_eq!(all.len(), ids.len());
        eprintln!("Tag traversal: {} records, depth {}, coherent validation plus indexed SQL closure {:?}", all.len(), ids.len(), start.elapsed());
        assert_eq!(TagService::subtree_in(c, ids[1999]).await?, vec![ids[1999]]);
        Ok::<_, TagError>(())
    })).await.unwrap();
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
