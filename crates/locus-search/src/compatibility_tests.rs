#![allow(clippy::expect_used, clippy::unwrap_used)]
use crate::{
    error::SearchError,
    service::{SearchRequest, SearchService},
};
use diesel_async::SimpleAsyncConnection;
use locus_core::api::{ComponentId, EntityId, Kernel, KindId};
use locus_query::api::*;
use locus_store::api::{Context, Session, TaskDatabase};
use locus_task::api::TaskQueue;
use std::sync::Arc;
struct Version(u32);
impl Provider for Version {
    fn kind(&self) -> KindId {
        KindId::from_uuid(uuid::Uuid::from_u128(1))
    }
    fn definitions(&self) -> Vec<FieldDefinition> {
        let mut field = FieldDefinition::new("fixture", "fixture", FieldType::Text, Shape::Scalar);
        field.extraction_version = self.0;
        vec![field]
    }
    fn project<'a>(&'a self, _: &'a mut Context, _: ComponentId) -> ProjectionFuture<'a> {
        Box::pin(async { unreachable!("no attached components") })
    }
}
async fn ready(search: &SearchService) {
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let status = search.status();
            assert_ne!(status.state, "failed", "{status:?}");
            if status.state == "ready" {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn compatibility_and_missing_corrupt_generation_never_certify_empty_cache() {
    let root = tempfile::tempdir().unwrap();
    let queue = TaskQueue::new();
    let db = TaskDatabase::open(&queue, root.path().join("metadata.sqlite"))
        .await
        .unwrap();
    let mut session = Session::open(root.path().join("metadata.sqlite"))
        .await
        .unwrap();
    locus_migration::api::migrate(&mut session).await.unwrap();
    let entity = EntityId::new();
    let hex: String = entity
        .as_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    session
        .transaction::<_, SearchError, _>(move |c| {
            Box::pin(async move {
                c.connection()
                    .batch_execute(&format!(
                        "INSERT INTO locus_core_comm_entity (id) VALUES(X'{hex}')"
                    ))
                    .await?;
                Ok(())
            })
        })
        .await
        .unwrap();
    let start = |version| {
        SearchService::start(
            root.path(),
            queue.clone(),
            db.clone(),
            Kernel::new(),
            vec![Arc::new(Version(version))],
            Arc::new(()),
        )
        .unwrap()
    };
    let one = start(1);
    ready(&one).await;
    let old = one.status().generation.unwrap();
    one.shutdown().await;
    drop(one);
    let two = start(2);
    ready(&two).await;
    let second = two.status().generation.unwrap();
    assert_ne!(old, second);
    assert_eq!(
        two.query(SearchRequest {
            text: "".into(),
            filter: None
        })
        .await
        .unwrap()
        .bytes
        .len(),
        16
    );
    two.shutdown().await;
    drop(two);
    std::fs::write(
        root.path()
            .join("cache/search")
            .join(&second)
            .join("meta.json"),
        "corrupt",
    )
    .unwrap();
    let three = start(2);
    ready(&three).await;
    assert_ne!(three.status().generation.as_deref(), Some(second.as_str()));
    assert_eq!(
        three
            .query(SearchRequest {
                text: "".into(),
                filter: None
            })
            .await
            .unwrap()
            .bytes
            .len(),
        16
    );
    three.shutdown().await;
    drop(three);
    std::fs::remove_file(root.path().join("cache/search/current")).unwrap();
    let four = start(2);
    ready(&four).await;
    assert_eq!(
        four.query(SearchRequest {
            text: "".into(),
            filter: None
        })
        .await
        .unwrap()
        .bytes
        .len(),
        16
    );
    four.shutdown().await;
}
