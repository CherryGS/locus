#![allow(clippy::expect_used, clippy::unwrap_used)]
use diesel::{QueryableByName, sql_query, sql_types::BigInt};
use diesel_async::{RunQueryDsl, SimpleAsyncConnection};
use locus_store::api::{StoreError, TaskDatabase};
use locus_task::api::{TaskError, TaskHandle, TaskQueue, TaskState};
use std::{future::Future, time::Duration};
use tokio::sync::oneshot;

async fn bounded<T>(future: impl Future<Output = T>) -> T {
    tokio::time::timeout(Duration::from_secs(10), future)
        .await
        .unwrap()
}
async fn waiting<T>(handle: &TaskHandle<T>) {
    let mut changes = handle.subscribe();
    loop {
        if changes.borrow_and_update().state == TaskState::Waiting {
            return;
        }
        changes.changed().await.unwrap();
    }
}
#[derive(QueryableByName)]
struct Count {
    #[diesel(sql_type = BigInt)]
    count: i64,
}

#[tokio::test(flavor = "multi_thread")]
async fn canonical_database_connections_share_exclusion_and_participants_reuse_context() {
    bounded(async {
        let dir = tempfile::tempdir().unwrap();
        let q = TaskQueue::new();
        let first = TaskDatabase::open(&q, dir.path().join("same.sqlite"))
            .await
            .unwrap();
        let same = TaskDatabase::open(&q, dir.path().join(".").join("same.sqlite"))
            .await
            .unwrap();
        let distinct = TaskDatabase::open(&q, dir.path().join("other.sqlite"))
            .await
            .unwrap();
        let (entered, ready) = oneshot::channel();
        let (release, wait) = oneshot::channel();
        let owner = q
            .submit("owner", move |task| async move {
                let mut session = first.session(&task).await.unwrap();
                session
                    .transaction::<_, StoreError, _>(move |context| {
                        Box::pin(async move {
                            context
                                .connection()
                                .batch_execute("CREATE TABLE notes (id INTEGER PRIMARY KEY)")
                                .await?;
                            context
                                .savepoint::<_, StoreError, _>(|c| {
                                    Box::pin(async move {
                                        c.connection()
                                            .batch_execute("INSERT INTO notes VALUES (1)")
                                            .await?;
                                        Ok(())
                                    })
                                })
                                .await?;
                            assert!(matches!(
                                task.enter("illegal nested stage", &[]).await,
                                Err(TaskError::NestedStage)
                            ));
                            entered.send(()).unwrap();
                            wait.await.unwrap();
                            Ok(())
                        })
                    })
                    .await
                    .unwrap();
            })
            .unwrap();
        ready.await.unwrap();
        let second = q
            .submit("same DB", move |task| async move {
                let mut session = same.session(&task).await.unwrap();
                session
                    .transaction::<_, StoreError, _>(|c| {
                        Box::pin(async move {
                            Ok(sql_query("SELECT count(*) AS count FROM notes")
                                .get_result::<Count>(c.connection())
                                .await?
                                .count)
                        })
                    })
                    .await
                    .unwrap()
            })
            .unwrap();
        waiting(&second).await;
        q.submit("different DB", move |task| async move {
            let mut session = distinct.session(&task).await.unwrap();
            session
                .transaction::<_, StoreError, _>(|c| {
                    Box::pin(async move {
                        c.connection()
                            .batch_execute("CREATE TABLE independent (id INTEGER)")
                            .await?;
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
        assert_eq!(second.snapshot().state, TaskState::Waiting);
        release.send(()).unwrap();
        owner.result().await.unwrap();
        assert_eq!(second.result().await.unwrap(), 1);
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn memory_databases_are_distinct_and_foreign_binding_is_rejected() {
    bounded(async {
        let q = TaskQueue::new();
        let other = TaskQueue::new();
        let queue = q.clone();
        q.submit("memory", move |task| async move {
            assert!(matches!(
                TaskDatabase::memory(&other, &task).await,
                Err(StoreError::Task(TaskError::ForeignResource))
            ));
            let mut a = TaskDatabase::memory(&queue, &task).await.unwrap();
            let mut b = TaskDatabase::memory(&queue, &task).await.unwrap();
            a.transaction::<_, StoreError, _>(|c| {
                Box::pin(async move {
                    c.connection()
                        .batch_execute("CREATE TABLE only_a (id INTEGER)")
                        .await?;
                    Ok(())
                })
            })
            .await
            .unwrap();
            assert!(
                b.transaction::<_, StoreError, _>(|c| Box::pin(async move {
                    c.connection().batch_execute("SELECT * FROM only_a").await?;
                    Ok(())
                }))
                .await
                .is_err()
            );
        })
        .unwrap()
        .result()
        .await
        .unwrap();
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn independently_created_memory_databases_do_not_share_a_lock() {
    bounded(async {
        let queue = TaskQueue::new();
        let q = queue.clone();
        let (entered, ready) = oneshot::channel();
        let (release, wait) = oneshot::channel();
        let holder = queue
            .submit("memory holder", move |task| async move {
                let mut session = TaskDatabase::memory(&q, &task).await.unwrap();
                session
                    .transaction::<_, StoreError, _>(move |_| {
                        Box::pin(async move {
                            entered.send(()).unwrap();
                            wait.await.unwrap();
                            Ok(())
                        })
                    })
                    .await
                    .unwrap();
            })
            .unwrap();
        ready.await.unwrap();
        let q = queue.clone();
        queue
            .submit("other memory", move |task| async move {
                let mut session = TaskDatabase::memory(&q, &task).await.unwrap();
                session
                    .transaction::<_, StoreError, _>(|c| {
                        Box::pin(async move {
                            c.connection()
                                .batch_execute("CREATE TABLE independent (id INTEGER)")
                                .await?;
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
        assert_eq!(holder.snapshot().state, TaskState::Running);
        release.send(()).unwrap();
        holder.result().await.unwrap();
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn canceled_bound_transaction_discards_connection_and_rolls_back() {
    bounded(async {
        let dir = tempfile::tempdir().unwrap(); let q = TaskQueue::new();
        let db = TaskDatabase::open(&q, dir.path().join("cancel.sqlite")).await.unwrap(); let read = db.clone();
        q.submit("cancel", move |task| async move {
            let mut session = db.session(&task).await.unwrap();
            session.transaction::<_, StoreError, _>(|c| Box::pin(async move { c.connection().batch_execute("CREATE TABLE notes (id INTEGER)").await?; Ok(()) })).await.unwrap();
            let (written, ready) = oneshot::channel();
            {
                let transaction = session.transaction::<(), StoreError, _>(move |c| Box::pin(async move {
                    c.connection().batch_execute("INSERT INTO notes VALUES (1)").await?;
                    written.send(()).unwrap(); std::future::pending().await
                }));
                tokio::pin!(transaction);
                tokio::select! { _ = ready => (), result = &mut transaction => panic!("unexpected {result:?}") }
            }
            assert!(!session.is_usable());
        }).unwrap().result().await.unwrap();
        let count = q.submit("reopen", move |task| async move {
            let mut session = read.session(&task).await.unwrap();
            session.transaction::<_, StoreError, _>(|c| Box::pin(async move { Ok(sql_query("SELECT count(*) AS count FROM notes").get_result::<Count>(c.connection()).await?.count) })).await.unwrap()
        }).unwrap().result().await.unwrap();
        assert_eq!(count, 0);
    }).await;
}

struct OnDrop<F> {
    future: std::pin::Pin<Box<F>>,
    dropped: Option<oneshot::Sender<()>>,
}
impl<F: Future> Future for OnDrop<F> {
    type Output = F::Output;
    fn poll(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Self::Output> {
        self.future.as_mut().poll(cx)
    }
}
impl<F> Drop for OnDrop<F> {
    fn drop(&mut self) {
        if let Some(sender) = self.dropped.take() {
            let _ = sender.send(());
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn canceling_driver_work_keeps_database_excluded_until_actual_disposition() {
    bounded(async {
        let dir = tempfile::tempdir().unwrap();
        let q = TaskQueue::new();
        let db = TaskDatabase::open(&q, dir.path().join("blocking.sqlite"))
            .await
            .unwrap();
        let next_db = db.clone();
        let (started, ready) = oneshot::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let (aborts, abort) = oneshot::channel();
        let (dropped, dropping) = oneshot::channel();
        let owner = q
            .submit("driver", move |task| async move {
                let mut session = db.session(&task).await.unwrap();
                let child = tokio::spawn(async move {
                    let transaction = session.transaction::<_, StoreError, _>(move |c| {
                        Box::pin(async move {
                            c.connection()
                                .spawn_blocking(move |connection| {
                                    use diesel::connection::SimpleConnection;
                                    connection
                                        .batch_execute("CREATE TABLE rolled_back (id INTEGER)")?;
                                    started.send(()).unwrap();
                                    wait.recv().unwrap();
                                    Ok::<_, diesel::result::Error>(())
                                })
                                .await?;
                            Ok(())
                        })
                    });
                    OnDrop {
                        future: Box::pin(transaction),
                        dropped: Some(dropped),
                    }
                    .await
                });
                aborts.send(child.abort_handle()).unwrap();
                assert!(child.await.unwrap_err().is_cancelled());
            })
            .unwrap();
        let abort = abort.await.unwrap();
        ready.await.unwrap();
        abort.abort();
        dropping.await.unwrap();
        let next = q
            .submit("after disposition", move |task| async move {
                let mut session = next_db.session(&task).await.unwrap();
                session
                    .transaction::<_, StoreError, _>(|c| {
                        Box::pin(async move {
                            // The cancelled CREATE TABLE was rolled back before this access.
                            c.connection()
                                .batch_execute("CREATE TABLE rolled_back (id INTEGER)")
                                .await?;
                            Ok(())
                        })
                    })
                    .await
                    .unwrap();
            })
            .unwrap();
        waiting(&next).await;
        assert_eq!(owner.snapshot().state, TaskState::Running);
        release.send(()).unwrap();
        owner.result().await.unwrap();
        next.result().await.unwrap();
    })
    .await;
}
