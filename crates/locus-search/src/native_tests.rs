#![allow(clippy::expect_used, clippy::unwrap_used)]
use crate::{collector::Complete, compiler, schema::Mapping};
use locus_core::api::{ComponentId, EntityId};
use locus_query::api::*;
#[test]
fn native_types_presence_scores_and_full_complement() {
    let catalogue = Catalogue::new(vec![
        FieldDefinition::new("title", "test", FieldType::Text, Shape::Scalar),
        FieldDefinition::new("opaque", "test", FieldType::Identifier, Shape::Scalar),
        FieldDefinition::new("count", "test", FieldType::Uint, Shape::Scalar),
        FieldDefinition::new("tags", "test", FieldType::Text, Shape::Collection),
    ])
    .unwrap();
    let m = Mapping::new(&catalogue).unwrap();
    let index = tantivy::Index::create_in_ram(m.schema.clone());
    m.configure(&index);
    let mut writer = index.writer_with_num_threads(1, 15_000_000).unwrap();
    let ids = [
        EntityId::new(),
        EntityId::new(),
        EntityId::new(),
        EntityId::new(),
    ];
    let component = ComponentId::new();
    for (i, id) in ids.iter().enumerate() {
        let title = [Some("alpha beta"), Some("alpha"), Some(" "), None][i];
        let opaque = ["123", "2026-01-01T00:00:00Z", "large", ""][i];
        let values = vec![
            FieldValue::scalar("title", component, title.map(|v| Value::Text(v.into()))),
            FieldValue::scalar("opaque", component, Some(Value::Identifier(opaque.into()))),
            FieldValue::scalar(
                "count",
                component,
                if i == 0 {
                    Some(Value::Uint(u64::MAX.to_string()))
                } else {
                    None
                },
            ),
            FieldValue::collection(
                "tags",
                component,
                if i == 0 {
                    Some(vec![Value::Text("".into())])
                } else if i == 1 {
                    Some(vec![Value::Text("beta".into())])
                } else {
                    Some(vec![])
                },
            ),
        ];
        writer
            .add_document(m.document(*id, &values).unwrap())
            .unwrap();
    }
    writer.commit().unwrap();
    writer.wait_merging_threads().unwrap();
    let reader = index.reader().unwrap();
    let searcher = reader.searcher();
    let run = |source: &str| {
        let p = native_program(source);
        let q = compiler::program(&index, &m, &p).unwrap();
        let mut hits = searcher.search(&*q, &Complete { scoring: true }).unwrap();
        hits.sort_by_key(|v| v.1);
        hits
    };
    for source in [
        "opaque:IN [123]",
        "opaque:[123 TO 123]",
        "count:18446744073709551615",
        "count:00018446744073709551615",
        "count:IN [00018446744073709551615]",
        "count:[18446744073709551615 TO 18446744073709551615]",
    ] {
        assert_eq!(
            run(source).iter().map(|v| v.1).collect::<Vec<_>>(),
            vec![*ids[0].as_bytes()],
            "{source}"
        );
    }
    assert_eq!(run("opaque:IN [\"2026-01-01T00:00:00Z\"]").len(), 1);
    assert_eq!(run("tags:*").len(), 2);
    assert_eq!(run("\"alpha beta\"").len(), 1);
    assert_eq!(run("title:IN [ALPHA]").len(), 2);
    assert_eq!(run("title:[ALPHA TO ALPHA]").len(), 2);
    assert_eq!(run("title:*").len(), 3);
    assert_eq!(run("NOT title:*").len(), 1);
    assert!(run("NOT (NOT title:*)").iter().all(|v| v.0 == 0.0));
    for source in [
        "alpha",
        "+alpha beta",
        "alpha OR beta",
        "alpha^2 beta",
        "alpha alpha",
        "(alpha OR beta) AND alpha",
    ] {
        assert_eq!(run(source), run(&format!("({source})")), "{source}");
    }
    // Real pinned-engine baseline, independent of our compilation path.
    for source in [
        "alpha",
        "+alpha beta",
        "alpha OR beta",
        "alpha^2 beta",
        "alpha alpha",
        "alpha OR (alpha OR beta)",
        "alpha AND (alpha AND beta)",
        "(alpha OR beta) AND alpha",
        "(alpha OR beta)^2 alpha",
    ] {
        let baseline = tantivy::query::QueryParser::for_index(&index, m.defaults.clone())
            .parse_query(source)
            .unwrap();
        let mut hits = searcher
            .search(&*baseline, &Complete { scoring: true })
            .unwrap();
        hits.sort_by_key(|v| v.1);
        assert_eq!(run(source), hits, "native baseline: {source}");
    }
    assert_eq!(run("alpha alpha"), run("(alpha) (alpha)"));
    assert_eq!(run("+alpha beta").len(), 2);
    assert_eq!(run("NOT (NOT alpha)").len(), 2);
    assert!(compiler::program(&index, &m, &native_program("count:abc")).is_err());
}

fn native_program(text: &str) -> Program {
    Program {
        source: Source {
            format: String::new(),
            version: 0,
            text: text.into(),
        },
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn actual_admission_excludes_a_competing_write_and_pins_original_evidence() {
    use crate::service::SearchService;
    use diesel_async::SimpleAsyncConnection;
    use locus_core::api::Kernel;
    use locus_store::api::{Session, StoreError, TaskDatabase};
    use locus_task::api::TaskQueue;
    use std::sync::Arc;
    let root = tempfile::tempdir().unwrap();
    let queue = TaskQueue::new();
    let database = TaskDatabase::open(&queue, root.path().join("metadata.sqlite"))
        .await
        .unwrap();
    let mut session = Session::open(root.path().join("metadata.sqlite"))
        .await
        .unwrap();
    locus_migration::api::migrate(&mut session).await.unwrap();
    let a = EntityId::new();
    let b = EntityId::new();
    let later = EntityId::new();
    let hex = |id: EntityId| {
        id.as_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    };
    let sql = format!(
        "INSERT INTO locus_core_comm_entity VALUES(X'{}'),(X'{}')",
        hex(a),
        hex(b)
    );
    session
        .transaction::<_, StoreError, _>(move |c| {
            Box::pin(async move {
                c.connection().batch_execute(&sql).await?;
                Ok(())
            })
        })
        .await
        .unwrap();
    let search = SearchService::start(
        root.path(),
        queue.clone(),
        database.clone(),
        Kernel::new(),
        vec![],
        Arc::new(()),
    )
    .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(20), async {
        while search.status().state != "ready" {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let (entered, release) = search.pause_next_admission();
    let service = search.clone();
    let querying = tokio::spawn(async move {
        service
            .query_program(native_program("entity_id:*"))
            .await
            .unwrap()
    });
    entered.notified().await;
    let (started, waiting) = tokio::sync::oneshot::channel();
    let sql = format!(
        "DELETE FROM locus_core_comm_entity WHERE id=X'{}'; INSERT INTO locus_core_comm_entity VALUES(X'{}')",
        hex(a),
        hex(later)
    );
    let write = queue
        .submit("competing writer", move |task| async move {
            started.send(()).unwrap();
            let mut s = database.session(&task).await.unwrap();
            s.transaction::<_, StoreError, _>(move |c| {
                Box::pin(async move {
                    c.connection().batch_execute(&sql).await?;
                    Ok(())
                })
            })
            .await
            .unwrap();
        })
        .unwrap();
    waiting.await.unwrap();
    let mut write = Box::pin(write.result());
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(30), &mut write)
            .await
            .is_err()
    );
    release.notify_one();
    let pinned = querying.await.unwrap();
    assert_eq!(
        pinned.bytes,
        [a.as_bytes().as_slice(), b.as_bytes().as_slice()].concat()
    );
    write.await.unwrap();
    assert_eq!(
        search.status().covered_sequence,
        search.status().journal_head
    );
    let next = search
        .query_program(native_program("entity_id:*"))
        .await
        .unwrap();
    assert_eq!(
        next.bytes,
        [b.as_bytes().as_slice(), later.as_bytes().as_slice()].concat()
    );
    let evidence = search.evidence(&pinned.context, &[a]).unwrap();
    assert_eq!(evidence[0].matches.len(), 1);
    assert_eq!(
        evidence[0].matches[0].condition.as_deref(),
        Some("entity_id:*")
    );
    assert!(search.evidence(&next.context, &[a]).is_err());
    search.shutdown().await;
}
