#![allow(clippy::expect_used, clippy::unwrap_used)]
use diesel_async::SimpleAsyncConnection;
use locus_store::api::{StoreError, TaskDatabase};
use locus_task::api::TaskQueue;
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn participating_sessions_retain_exclusion_after_the_lease_is_dropped() {
    let dir = tempfile::tempdir().unwrap();
    let queue = TaskQueue::new();
    let db = TaskDatabase::open(&queue, dir.path().join("db.sqlite"))
        .await
        .unwrap();
    let first = db.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    let (release, wait) = tokio::sync::oneshot::channel();
    let holder = queue
        .submit("participating session", move |task| async move {
            let protected = first.protect(&task).await.unwrap();
            let mut session = protected.session().await.unwrap();
            drop(protected);
            session
                .transaction::<_, StoreError, _>(|c| {
                    Box::pin(async move {
                        c.connection()
                            .batch_execute(
                                "CREATE TABLE items(id INTEGER); INSERT INTO items VALUES (1)",
                            )
                            .await?;
                        Ok(())
                    })
                })
                .await
                .unwrap();
            tx.send(()).unwrap();
            wait.await.unwrap();
            // A failed unit must roll back without losing participation or poisoning a
            // subsequent transaction on this independently retained session.
            assert!(
                session
                    .transaction::<_, StoreError, _>(|c| Box::pin(async move {
                        c.connection()
                            .batch_execute("INSERT INTO absent VALUES(2)")
                            .await?;
                        Ok(())
                    }))
                    .await
                    .is_err()
            );
            session
                .transaction::<_, StoreError, _>(|c| {
                    Box::pin(async move {
                        c.connection()
                            .batch_execute("INSERT INTO items VALUES(2)")
                            .await?;
                        Ok(())
                    })
                })
                .await
                .unwrap();
        })
        .unwrap();
    rx.await.unwrap();
    let competing = queue
        .submit("competing writer", move |task| async move {
            let mut session = db.session(&task).await.unwrap();
            session
                .transaction::<_, StoreError, _>(|c| {
                    Box::pin(async move {
                        c.connection()
                            .batch_execute("INSERT INTO items VALUES(3)")
                            .await?;
                        Ok(())
                    })
                })
                .await
                .unwrap();
        })
        .unwrap();
    let mut next = Box::pin(competing.result());
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(40), &mut next)
            .await
            .is_err()
    );
    release.send(()).unwrap();
    holder.result().await.unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), next)
        .await
        .unwrap()
        .unwrap();
}
