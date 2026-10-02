#![allow(clippy::expect_used, clippy::unwrap_used)]
use crate::{
    error::SearchError,
    service::{SearchRequest, SearchService},
};
use diesel::{
    QueryableByName, sql_query,
    sql_types::{Binary, Text},
};
use diesel_async::{RunQueryDsl, SimpleAsyncConnection};
use locus_core::api::{ComponentId, EntityId, Kernel, KindId};
use locus_query::api::*;
use locus_store::api::{Context, Session, TaskDatabase};
use locus_task::api::TaskQueue;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
struct Fixture {
    calls: Arc<AtomicUsize>,
}
impl Provider for Fixture {
    fn kind(&self) -> KindId {
        KindId::from_uuid(uuid::Uuid::from_u128(12))
    }
    fn definitions(&self) -> Vec<FieldDefinition> {
        vec![
            FieldDefinition::new(
                "direct",
                "fixture",
                FieldType::Identifier,
                Shape::Collection,
            ),
            FieldDefinition::new("title", "fixture", FieldType::Text, Shape::Scalar),
        ]
    }
    fn references(&self) -> Vec<ReferenceDefinition> {
        vec![ReferenceDefinition {
            id: "subtree".into(),
            owner: "fixture".into(),
            target_field: "direct".into(),
            meaning: ReferenceMeaning::InclusiveSubtree,
        }]
    }
    fn resolve_reference<'a>(
        &'a self,
        c: &'a mut Context,
        operand: &'a ReferenceOperand,
    ) -> ReferenceFuture<'a> {
        Box::pin(async move {
            self.calls.fetch_add(1, Ordering::SeqCst);
            #[derive(QueryableByName)]
            struct Row {
                #[diesel(sql_type=Text)]
                value: String,
            }
            let rows=sql_query("WITH RECURSIVE branch(value) AS (SELECT id FROM fixture_tree WHERE id=? UNION SELECT t.id FROM fixture_tree t JOIN branch b ON t.parent=b.value) SELECT value FROM branch ORDER BY value").bind::<Text,_>(&operand.identity).load::<Row>(c.connection()).await.map_err(|e| QueryError::Invalid(e.to_string()))?;
            if rows.is_empty() {
                return Err(QueryError::Invalid("missing required root".into()));
            }
            Ok(rows.into_iter().map(|r| r.value).collect())
        })
    }
    fn reference_choices<'a>(
        &'a self,
        c: &'a mut Context,
        _reference: &'a str,
    ) -> ReferenceChoicesFuture<'a> {
        Box::pin(async move {
            #[derive(QueryableByName)]
            struct Row {
                #[diesel(sql_type=Text)]
                id: String,
            }
            let rows = sql_query("SELECT id FROM fixture_tree ORDER BY id")
                .load::<Row>(c.connection())
                .await
                .map_err(|e| QueryError::Invalid(e.to_string()))?;
            Ok(rows
                .into_iter()
                .map(|r| ReferenceChoice {
                    name: r.id.clone(),
                    identity: r.id,
                })
                .collect())
        })
    }
    fn project<'a>(&'a self, c: &'a mut Context, id: ComponentId) -> ProjectionFuture<'a> {
        Box::pin(async move {
            #[derive(QueryableByName)]
            struct Row {
                #[diesel(sql_type=Text)]
                tag: String,
                #[diesel(sql_type=Text)]
                title: String,
            }
            let row = sql_query("SELECT tag,title FROM fixture_direct WHERE id=?")
                .bind::<Binary, _>(id.as_bytes().as_slice())
                .get_result::<Row>(c.connection())
                .await
                .map_err(|e| QueryError::Projection(e.to_string()))?;
            Ok(vec![
                FieldValue::collection("direct", id, Some(vec![Value::Identifier(row.tag)])),
                FieldValue::scalar("title", id, Some(Value::Text(row.title))),
            ])
        })
    }
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
async fn sql(s: &mut Session, text: String) {
    s.transaction::<_, SearchError, _>(move |c| {
        Box::pin(async move {
            c.connection().batch_execute(&text).await?;
            Ok(())
        })
    })
    .await
    .unwrap();
}
fn program(text: String) -> Program {
    Program {
        source: Source {
            format: "fixture".into(),
            version: 1,
            text,
        },
    }
}
fn identities(bytes: &[u8]) -> Vec<EntityId> {
    bytes
        .chunks_exact(16)
        .map(|b| EntityId::from_bytes(b).unwrap())
        .collect()
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn protected_reference_capture_zero_score_all_branches_and_old_evidence() {
    let dir = tempfile::tempdir().unwrap();
    let queue = TaskQueue::new();
    let db = TaskDatabase::open(&queue, dir.path().join("metadata.sqlite"))
        .await
        .unwrap();
    let mut session = Session::open(dir.path().join("metadata.sqlite"))
        .await
        .unwrap();
    locus_migration::api::migrate(&mut session).await.unwrap();
    let root = uuid::Uuid::now_v7().to_string();
    let child = uuid::Uuid::now_v7().to_string();
    let other = uuid::Uuid::now_v7().to_string();
    sql(&mut session,format!("CREATE TABLE fixture_tree(id TEXT PRIMARY KEY,parent TEXT);CREATE TABLE fixture_direct(id BLOB,tag TEXT,title TEXT);INSERT INTO fixture_tree VALUES('{root}',NULL),('{child}','{root}'),('{other}',NULL);")).await;
    let calls = Arc::new(AtomicUsize::new(0));
    let provider = Fixture {
        calls: calls.clone(),
    };
    let kind = hex(provider.kind().as_bytes());
    let a = EntityId::new();
    let b = EntityId::new();
    for (entity, tag, title) in [(a, &child, "alpha alpha beta"), (b, &root, "alpha")] {
        let component = ComponentId::new();
        sql(&mut session,format!("INSERT INTO locus_core_comm_entity VALUES(X'{}');INSERT INTO locus_core_comm_component_registry VALUES(X'{}',X'{kind}');INSERT INTO locus_core_rela_membership VALUES(X'{}',X'{kind}',X'{}');INSERT INTO fixture_direct VALUES(X'{}','{tag}','{title}');",hex(entity.as_bytes()),hex(component.as_bytes()),hex(entity.as_bytes()),hex(component.as_bytes()),hex(component.as_bytes()))).await;
    }
    let search = SearchService::start(
        dir.path(),
        queue.clone(),
        db.clone(),
        Kernel::new(),
        vec![Arc::new(provider)],
        Arc::new(()),
    )
    .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(20), async {
        while !search.status().usable {
            assert_ne!(search.status().state, "failed");
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let (building, resume_build) = search.pause_next_build();
    search.rebuild().unwrap();
    building.notified().await;
    let choices = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        search.reference_choices("subtree".into()),
    )
    .await;
    // Always release the build, including on assertion failure, to keep the fixture finite.
    resume_build.notify_one();
    assert_eq!(
        choices
            .expect("primary choices must not wait for index preparation")
            .unwrap()
            .len(),
        3
    );
    let run = |text: String| search.query_program(program(text));
    let text = format!("subtree:\"{root}\"");
    let first = run(text.clone()).await.unwrap();
    assert_eq!(identities(&first.bytes), vec![a, b]);
    let before = calls.as_ref().load(Ordering::SeqCst);
    let duplicate = run(format!(
        "{text} OR subtree:\"{}\" OR {text}^10",
        root.replace('-', "").to_uppercase()
    ))
    .await
    .unwrap();
    assert_eq!(identities(&duplicate.bytes), vec![a, b]);
    assert_eq!(calls.as_ref().load(Ordering::SeqCst) - before, 1);
    assert_eq!(
        identities(&run(format!("subtree:\"{child}\"")).await.unwrap().bytes),
        vec![a]
    );
    assert!(
        run(format!("subtree:\"{other}\""))
            .await
            .unwrap()
            .bytes
            .is_empty()
    );
    for suffix in ["*", "IN [x y]", "/abc/", "[1 TO 9]", "not-a-uuid"] {
        assert!(run(format!("subtree:{suffix}")).await.is_err());
    }
    assert!(run(format!("{text}* ")).await.is_err());
    let plain = run("title:alpha".into()).await.unwrap();
    let optional = run(format!("+title:alpha {text}^50")).await.unwrap();
    assert_eq!(plain.bytes, optional.bytes);
    let plain_context = search.context(&plain.context).unwrap();
    let optional_context = search.context(&optional.context).unwrap();
    let scores = |context: &crate::service::QueryContext| {
        let q = crate::compiler::program_bound(
            &context.publication.index,
            &search.mapping,
            context.program.as_ref().unwrap(),
            Some(&context.bindings),
        )
        .unwrap();
        let mut hits = context
            .searcher
            .search(&*q, &crate::collector::Complete { scoring: true })
            .unwrap();
        hits.sort_by_key(|h| h.1);
        hits
    };
    assert_eq!(scores(&plain_context), scores(&optional_context));
    let first_context = search.context(&first.context).unwrap();
    assert!(
        scores(&first_context)
            .iter()
            .all(|(score, _)| *score == 0.0)
    );
    let operand = ReferenceOperand {
        reference: "subtree".into(),
        identity: root.to_uppercase(),
    };
    let typed = search
        .query(SearchRequest {
            text: String::new(),
            filter: Some(Condition::Reference(operand.clone())),
        })
        .await
        .unwrap();
    assert_eq!(typed.bytes, first.bytes);
    // A hierarchy write queues behind the real capture protection. After capture it
    // changes both membership closure and a direct annotation in one transaction.
    let (entered, release) = search.pause_next_admission();
    let copy = search.clone();
    let query_text = text.clone();
    let querying =
        tokio::spawn(async move { copy.query_program(program(query_text)).await.unwrap() });
    entered.notified().await;
    let moved_child = child.clone();
    let new_parent = other.clone();
    let bhex = hex(b.as_bytes());
    let writer = db.clone();
    let write=queue.submit("move while capturing",move|task|async move {let mut s=writer.session(&task).await.unwrap();s.transaction::<_,SearchError,_>(move|c|Box::pin(async move{c.connection().batch_execute(&format!("UPDATE fixture_tree SET parent='{new_parent}' WHERE id='{moved_child}';UPDATE fixture_direct SET tag='{moved_child}';INSERT INTO locus_search_comm_invalidation(entity) VALUES(X'{bhex}');")).await?;Ok(())})).await.unwrap();}).unwrap();
    release.notify_one();
    let captured = querying.await.unwrap();
    write.result().await.unwrap();
    assert_eq!(captured.bytes, first.bytes);
    assert!(run(text.clone()).await.unwrap().bytes.is_empty());
    assert_eq!(search.evidence(&first.context, &[a, b]).unwrap().len(), 2);
    assert_eq!(search.evidence(&typed.context, &[a, b]).unwrap().len(), 2);
    sql(
        &mut session,
        format!("DELETE FROM fixture_tree WHERE id='{root}'"),
    )
    .await;
    for source in [
        text.clone(),
        format!("NOT {text}"),
        format!("entity_id:* OR {text}"),
        format!("+entity_id:* {text}"),
        format!("-{text}"),
    ] {
        assert!(run(source).await.is_err());
    }
    for condition in [
        Condition::Reference(operand.clone()),
        Condition::Not(Box::new(Condition::Reference(operand.clone()))),
        Condition::Or(vec![Condition::Reference(operand)]),
    ] {
        assert!(
            search
                .query(SearchRequest {
                    text: String::new(),
                    filter: Some(condition)
                })
                .await
                .is_err()
        );
    }
    assert!(search.evidence(&first.context, &[a, b]).is_ok());
    search.shutdown().await;
}
