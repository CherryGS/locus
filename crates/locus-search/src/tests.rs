#![allow(clippy::expect_used, clippy::unwrap_used)]
use crate::{
    error::SearchError,
    service::{SearchRequest, SearchService},
};
use diesel::{
    QueryableByName, sql_query,
    sql_types::{Binary, Nullable, Text},
};
use diesel_async::{RunQueryDsl, SimpleAsyncConnection};
use locus_core::api::{ComponentId, EntityId, Kernel, KindId};
use locus_query::api::*;
use locus_store::api::{Context, Session, TaskDatabase};
use locus_task::api::TaskQueue;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

struct FixtureProvider {
    fail: Arc<AtomicBool>,
}
impl Provider for FixtureProvider {
    fn kind(&self) -> KindId {
        KindId::from_uuid(uuid::Uuid::from_u128(1))
    }
    fn definitions(&self) -> Vec<FieldDefinition> {
        vec![
            FieldDefinition::new("title", "fixture", FieldType::Text, Shape::Scalar),
            FieldDefinition::new("tags", "fixture", FieldType::Text, Shape::Collection),
            FieldDefinition::new("width", "fixture", FieldType::Uint, Shape::Scalar),
        ]
    }
    fn project<'a>(&'a self, c: &'a mut Context, id: ComponentId) -> ProjectionFuture<'a> {
        Box::pin(async move {
            if self.fail.as_ref().load(Ordering::SeqCst) {
                return Err(QueryError::Projection("selected projection failure".into()));
            }
            #[derive(QueryableByName)]
            struct Row {
                #[diesel(sql_type=Text)]
                title: String,
                #[diesel(sql_type=Nullable<Text>)]
                tags: Option<String>,
                #[diesel(sql_type=Nullable<Text>)]
                width: Option<String>,
            }
            let row = sql_query("SELECT title,tags,width FROM fixture WHERE id=?")
                .bind::<Binary, _>(id.as_bytes().as_slice())
                .get_result::<Row>(c.connection())
                .await
                .map_err(|e| QueryError::Projection(e.to_string()))?;
            Ok(vec![
                FieldValue {
                    field: "title".into(),
                    component: Some(id.to_string()),
                    value: if row.title.is_empty() {
                        ValueState::Empty
                    } else {
                        ValueState::Values(vec![Value::Text(row.title)])
                    },
                },
                FieldValue {
                    field: "tags".into(),
                    component: Some(id.to_string()),
                    value: match row.tags {
                        None => ValueState::Missing,
                        Some(v) => {
                            let values: Vec<String> = serde_json::from_str(&v).unwrap();
                            if values.is_empty() {
                                ValueState::Empty
                            } else {
                                ValueState::Values(values.into_iter().map(Value::Text).collect())
                            }
                        }
                    },
                },
                FieldValue {
                    field: "width".into(),
                    component: Some(id.to_string()),
                    value: row
                        .width
                        .map(|v| ValueState::Values(vec![Value::Uint(v)]))
                        .unwrap_or(ValueState::Missing),
                },
            ])
        })
    }
}
async fn sql(session: &mut Session, statement: String) {
    session
        .transaction::<_, SearchError, _>(move |c| {
            Box::pin(async move {
                c.connection().batch_execute(&statement).await?;
                Ok(())
            })
        })
        .await
        .unwrap();
}
async fn ready(search: &SearchService) {
    tokio::time::timeout(std::time::Duration::from_secs(30), async {
        loop {
            let status = search.status();
            assert_ne!(status.state, "failed", "{:?}", status);
            if status.state == "ready" {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
}
async fn query(search: &SearchService, text: &str, filter: Option<Condition>) -> Vec<EntityId> {
    let result = search
        .query(SearchRequest {
            text: text.into(),
            filter,
        })
        .await
        .unwrap();
    let ids = result
        .bytes
        .chunks_exact(16)
        .map(|b| EntityId::from_bytes(b).unwrap())
        .collect();
    search.release(&result.context);
    ids
}
fn predicate(field: &str, operation: Operation, values: Vec<Value>) -> Condition {
    Condition::Predicate(Predicate {
        field: field.into(),
        operation,
        values,
    })
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn native_structured_complete_evidence_replay_and_failure() {
    let temp = tempfile::tempdir().unwrap();
    let queue = TaskQueue::new();
    let db = TaskDatabase::open(&queue, temp.path().join("metadata.sqlite"))
        .await
        .unwrap();
    let mut session = Session::open(temp.path().join("metadata.sqlite"))
        .await
        .unwrap();
    locus_migration::api::migrate(&mut session).await.unwrap();
    sql(
        &mut session,
        "CREATE TABLE fixture(id BLOB PRIMARY KEY,title TEXT,tags TEXT,width TEXT)".into(),
    )
    .await;
    let a = EntityId::new();
    let b = EntityId::new();
    let empty = EntityId::new();
    let ca = ComponentId::new();
    let cb = ComponentId::new();
    let kind = hex(FixtureProvider {
        fail: Arc::default(),
    }
    .kind()
    .as_bytes());
    for (entity, component, title, tags, width) in [
        (
            a,
            ca,
            "Chinese 中文 图像 alpha",
            "'[\"red\",\"blue\"]'",
            "'1920'",
        ),
        (b, cb, "beta alpha", "'[]'", "NULL"),
    ] {
        sql(&mut session,format!("INSERT INTO locus_core_comm_entity VALUES(X'{}');INSERT INTO locus_core_comm_component_registry VALUES(X'{}',X'{kind}');INSERT INTO fixture VALUES(X'{}','{title}',{tags},{width});INSERT INTO locus_core_rela_membership VALUES(X'{}',X'{kind}',X'{}');",hex(entity.as_bytes()),hex(component.as_bytes()),hex(component.as_bytes()),hex(entity.as_bytes()),hex(component.as_bytes()))).await;
    }
    sql(
        &mut session,
        format!(
            "INSERT INTO locus_core_comm_entity VALUES(X'{}')",
            hex(empty.as_bytes())
        ),
    )
    .await;
    let fail = Arc::new(AtomicBool::new(false));
    let start = || {
        SearchService::start(
            temp.path(),
            queue.clone(),
            db.clone(),
            Kernel::new(),
            vec![Arc::new(FixtureProvider { fail: fail.clone() })],
            Arc::new(()),
        )
        .unwrap()
    };
    let search = start();
    ready(&search).await;
    assert_eq!(query(&search, "", None).await, vec![a, b, empty]);
    assert_eq!(
        query(&search, "title_exact:\"beta alpha\"", None).await,
        vec![b]
    );
    assert!(
        search
            .query(SearchRequest {
                text: "_entity:*".into(),
                filter: None
            })
            .await
            .is_err()
    );
    assert_eq!(query(&search, "Chinese beta", None).await.len(), 2); // native implicit OR
    assert_eq!(query(&search, "\"中文\"", None).await, vec![a]);
    assert_eq!(query(&search, "width:[1900 TO 2000]", None).await, vec![a]);
    assert!(
        search
            .query(SearchRequest {
                text: "title:\"unfinished".into(),
                filter: None
            })
            .await
            .is_err()
    );
    assert!(
        search
            .query(SearchRequest {
                text: "unknown:value".into(),
                filter: None
            })
            .await
            .is_err()
    );
    assert_eq!(
        query(
            &search,
            "",
            Some(predicate(
                "width",
                Operation::Ne,
                vec![Value::Uint("1920".into())]
            ))
        )
        .await,
        vec![]
    );
    assert_eq!(
        query(
            &search,
            "",
            Some(Condition::Not(Box::new(predicate(
                "width",
                Operation::Eq,
                vec![Value::Uint("1920".into())]
            ))))
        )
        .await,
        vec![b, empty]
    );
    assert_eq!(
        query(
            &search,
            "",
            Some(predicate(
                "tags",
                Operation::None,
                vec![Value::Text("green".into())]
            ))
        )
        .await,
        vec![a, b, empty]
    );
    assert_eq!(
        query(
            &search,
            "",
            Some(predicate(
                "tags",
                Operation::All,
                vec![Value::Text("red".into()), Value::Text("blue".into())]
            ))
        )
        .await,
        vec![a]
    );
    assert_eq!(query(&search, "NOT tags:*", None).await, vec![b, empty]);
    assert_eq!(
        query(
            &search,
            "alpha",
            Some(predicate("tags", Operation::Empty, vec![]))
        )
        .await,
        vec![b]
    );
    let typed_condition = Condition::Or(vec![
        predicate("width", Operation::Eq, vec![Value::Uint("1920".into())]),
        predicate("title", Operation::Eq, vec![Value::Text("never".into())]),
    ]);
    let typed = search
        .query(SearchRequest {
            text: String::new(),
            filter: Some(typed_condition),
        })
        .await
        .unwrap();
    let typed_evidence = search.evidence(&typed.context, &[a]).unwrap();
    assert_eq!(typed_evidence[0].matches.len(), 1);
    assert_eq!(typed_evidence[0].matches[0].field.as_deref(), Some("width"));
    assert_eq!(typed_evidence[0].matches[0].role, "alternative");
    let original = search
        .query(SearchRequest {
            text: "(title:alpha AND title:never) OR title:Chinese".into(),
            filter: None,
        })
        .await
        .unwrap();
    let evidence = search.evidence(&original.context, &[a]).unwrap();
    assert_eq!(
        evidence[0].matches[0].condition.as_deref(),
        Some("(title:alpha AND title:never) OR title:Chinese")
    );
    assert!(evidence[0].matches.iter().all(|m| m.component.is_none()));
    let published = search.status().covered_sequence;
    sql(&mut session,format!("UPDATE fixture SET title='changed' WHERE id=X'{}';UPDATE locus_core_comm_entity SET id=id WHERE id=X'{}'",hex(ca.as_bytes()),hex(a.as_bytes()))).await;
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        while search.status().covered_sequence == published {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(query(&search, "changed", None).await, vec![a]);
    assert!(
        !search.evidence(&original.context, &[a]).unwrap()[0]
            .matches
            .is_empty()
    );
    search.release(&original.context);
    assert!(search.evidence(&original.context, &[a]).is_err());
    fail.store(true, Ordering::SeqCst);
    sql(
        &mut session,
        format!(
            "UPDATE locus_core_comm_entity SET id=id WHERE id=X'{}'",
            hex(a.as_bytes())
        ),
    )
    .await;
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        while search.status().state != "failed" {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    assert!(search.status().usable);
    let failure = search.status().failure.unwrap();
    assert!(failure.contains(&a.to_string()));
    assert!(failure.contains(&ca.to_string()));
    assert!(failure.contains("Kind"));
    assert!(
        search
            .query(SearchRequest {
                text: "changed".into(),
                filter: None
            })
            .await
            .is_err()
    );
    fail.store(false, Ordering::SeqCst);
    search.retry().unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    ready(&search).await;
    for phase in 1..=4 {
        let prior = search.status().covered_sequence;
        search.fail_once(phase);
        sql(
            &mut session,
            format!(
                "UPDATE locus_core_comm_entity SET id=id WHERE id=X'{}'",
                hex(a.as_bytes())
            ),
        )
        .await;
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            while search.status().state != "failed" {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(search.status().covered_sequence, prior);
        assert_eq!(query(&search, "", None).await.len(), 3);
        search.retry().unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        ready(&search).await;
        assert_ne!(search.status().covered_sequence, prior);
        assert_eq!(query(&search, "", None).await.len(), 3);
    }
    search.shutdown().await;
    drop(search);
    fail.store(true, Ordering::SeqCst);
    sql(
        &mut session,
        format!(
            "UPDATE locus_core_comm_entity SET id=id WHERE id=X'{}'",
            hex(a.as_bytes())
        ),
    )
    .await;
    let search = start();
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        while search.status().state != "failed" {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert!(search.status().usable);
    assert!(
        search
            .query(SearchRequest {
                text: "changed".into(),
                filter: None
            })
            .await
            .is_err()
    );
    fail.store(false, Ordering::SeqCst);
    search.retry().unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    ready(&search).await;
    assert_eq!(query(&search, "", None).await.len(), 3);
    sql(
        &mut session,
        format!(
            "DELETE FROM locus_core_comm_entity WHERE id=X'{}'",
            hex(a.as_bytes())
        ),
    )
    .await;
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        while query(&search, "", None).await.len() != 2 {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    let retained = search
        .query(SearchRequest {
            text: "".into(),
            filter: None,
        })
        .await
        .unwrap();
    let old_path = temp.path().join("cache/search").join(&retained.generation);
    let (entered, release) = search.pause_next_build();
    search.rebuild().unwrap();
    entered.notified().await;
    let during = EntityId::new();
    sql(
        &mut session,
        format!(
            "INSERT INTO locus_core_comm_entity VALUES(X'{}')",
            hex(during.as_bytes())
        ),
    )
    .await;
    release.notify_one();
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        while search.status().generation.as_deref() == Some(&retained.generation) {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    ready(&search).await;
    assert_eq!(query(&search, "", None).await, vec![b, empty, during]);
    assert!(old_path.exists());
    assert!(search.evidence(&retained.context, &[b]).is_ok());
    search.expire_contexts();
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        while search.context_count() != 0 || old_path.exists() {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    search.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn dropping_live_worker_retains_lifetime_and_stops_after_actual_work() {
    struct Guard(Arc<AtomicBool>);
    impl Drop for Guard {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }
    let root = tempfile::tempdir().unwrap();
    let queue = TaskQueue::new();
    let db = TaskDatabase::open(&queue, root.path().join("metadata.sqlite"))
        .await
        .unwrap();
    let mut session = Session::open(root.path().join("metadata.sqlite"))
        .await
        .unwrap();
    locus_migration::api::migrate(&mut session).await.unwrap();
    let released = Arc::new(AtomicBool::new(false));
    let search = SearchService::start(
        root.path(),
        queue,
        db,
        Kernel::new(),
        vec![],
        Arc::new(Guard(released.clone())),
    )
    .unwrap();
    ready(&search).await;
    let (entered, release) = search.pause_next_build();
    search.rebuild().unwrap();
    entered.notified().await;
    drop(search);
    assert!(!released.as_ref().load(Ordering::SeqCst));
    release.notify_one();
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        while !released.as_ref().load(Ordering::SeqCst) {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}
