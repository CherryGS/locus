use super::{Server, ServerConfig};
use crate::api::{dto::*, filter::dto::*};
#[tokio::test(flavor = "multi_thread")]
async fn preset_write_survives_lost_waiter_and_is_recoverable_through_drain() {
    let root = tempfile::tempdir().unwrap();
    let server = Server::bind(ServerConfig::new(
        "test-credential-with-at-least-32-characters".into(),
        root.path().join("library"),
    ))
    .await
    .unwrap();
    let database = server.state.library.database.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    let (release, wait) = tokio::sync::oneshot::channel();
    let holder = server
        .state
        .queue
        .submit("hold database", move |task| async move {
            let _p = database.protect(&task).await.unwrap();
            tx.send(()).unwrap();
            wait.await.unwrap();
        })
        .unwrap();
    rx.await.unwrap();
    let id = uuid::Uuid::now_v7().to_string();
    let change = FilterChange::Create {
        name: "Incomplete".into(),
        source: locus_filter::api::native_source("@sql(unfinished").into(),
    };
    let state = server.state.clone();
    let request = id.clone();
    let submitted = change.clone();
    let waiter = tokio::spawn(async move { state.filter_write(request, submitted).await });
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while server.state.submission(&id).is_err() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(matches!(
        server.state.submission(&id).unwrap(),
        Submission::DirectPending
    ));
    waiter.abort();
    server.close_admission();
    assert!(!*server.state.drained.borrow());
    release.send(()).unwrap();
    holder.result().await.unwrap();
    server.state.wait_drained().await;
    let outcome = server.state.submission(&id).unwrap();
    let Submission::DirectComplete {
        outcome: MutationOutcome::FilterSaved { preset },
    } = outcome
    else {
        panic!("{outcome:?}")
    };
    assert_eq!(preset.source.text, "@sql(unfinished");
    assert_eq!(
        server.state.filter_write(id, change).await.unwrap(),
        MutationOutcome::FilterSaved { preset }
    );
}

use diesel_async::SimpleAsyncConnection;
use locus_core::api::{EntityId, Kernel};
use locus_filter::api::{compile, native_source};
use locus_search::api::SearchService;
use locus_store::api::{Session, StoreError, TaskDatabase};
use locus_task::api::TaskQueue;
use std::sync::Arc;
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn aligned_native_and_original_evidence() {
    let root = tempfile::tempdir().unwrap();
    let queue = TaskQueue::new();
    let database = TaskDatabase::open(&queue, root.path().join("metadata.sqlite"))
        .await
        .unwrap();
    let mut session = Session::open(root.path().join("metadata.sqlite"))
        .await
        .unwrap();
    locus_migration::api::migrate(&mut session).await.unwrap();
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
    let a = EntityId::new();
    let b = EntityId::new();
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
    let db = database.clone();
    queue
        .submit("write immediately before query", move |t| async move {
            let mut s = db.session(&t).await.unwrap();
            s.transaction::<_, StoreError, _>(move |c| {
                Box::pin(async move {
                    c.connection().batch_execute(&sql).await?;
                    Ok(())
                })
            })
            .await
            .unwrap();
        })
        .unwrap()
        .result()
        .await
        .unwrap();
    let p = compile(native_source("entity_id:*")).unwrap();
    assert_eq!(search.query_program(p).await.unwrap().bytes.len(), 32);
    let source = format!("(entity_id:\"{a}\" AND entity_id:\"{b}\") OR entity_id:\"{a}\"");
    let result = search
        .query_program(compile(native_source(&source)).unwrap())
        .await
        .unwrap();
    let evidence = search.evidence(&result.context, &[a]).unwrap();
    assert_eq!(evidence[0].matches.len(), 1);
    assert_eq!(
        evidence[0].matches[0].condition.as_deref(),
        Some(source.as_str())
    );
    let old = search
        .query_program(compile(native_source("entity_id:*")).unwrap())
        .await
        .unwrap();
    assert_eq!(old.bytes.len(), 32);
    let db = database.clone();
    let statement = format!("DELETE FROM locus_core_comm_entity WHERE id=X'{}'", hex(a));
    queue
        .submit("delete", move |t| async move {
            let mut s = db.session(&t).await.unwrap();
            s.transaction::<_, StoreError, _>(move |c| {
                Box::pin(async move {
                    c.connection().batch_execute(&statement).await?;
                    Ok(())
                })
            })
            .await
            .unwrap();
        })
        .unwrap()
        .result()
        .await
        .unwrap();
    assert!(
        !search.evidence(&old.context, &[a]).unwrap()[0]
            .matches
            .is_empty()
    );
    assert_eq!(
        search
            .query_program(compile(native_source("entity_id:*")).unwrap())
            .await
            .unwrap()
            .bytes
            .len(),
        16
    );
    search.shutdown().await;
}
