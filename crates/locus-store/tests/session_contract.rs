#![allow(clippy::expect_used, clippy::unwrap_used)]

use diesel::{QueryableByName, sql_query, sql_types::BigInt};
use diesel_async::{RunQueryDsl, SimpleAsyncConnection};
use locus_store::{Context, Session, StoreError};
use std::{future::pending, time::Duration};
use tokio::{sync::oneshot, time::timeout};

#[derive(QueryableByName)]
struct Count {
    #[diesel(sql_type = BigInt)]
    count: i64,
}

async fn count(context: &mut Context) -> Result<i64, StoreError> {
    Ok(sql_query("SELECT count(*) AS count FROM notes")
        .get_result::<Count>(context.connection())
        .await?
        .count)
}

async fn initialize(session: &mut Session) {
    session.transaction::<_, StoreError, _>(|context| Box::pin(async move {
        context.connection().batch_execute("CREATE TABLE notes (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO notes VALUES (1, 'committed');").await?;
        Ok(())
    })).await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn domain_neutral_data_reopens_and_failed_units_roll_back() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("data.sqlite");
    let mut session = Session::open(&path).await.unwrap();
    initialize(&mut session).await;
    let result = session
        .transaction::<(), StoreError, _>(|context| {
            Box::pin(async move {
                context
                    .connection()
                    .batch_execute("INSERT INTO notes VALUES (2, 'temporary')")
                    .await?;
                context
                    .connection()
                    .batch_execute("INSERT INTO notes VALUES (1, 'duplicate')")
                    .await?;
                Ok(())
            })
        })
        .await;
    assert!(matches!(result, Err(StoreError::Database(_))));
    assert!(session.is_usable());
    drop(session);
    let mut session = Session::open(&path).await.unwrap();
    assert_eq!(
        session
            .transaction(|context| Box::pin(count(context)))
            .await
            .unwrap(),
        1
    );
    let mut isolated = Session::memory().await.unwrap();
    let missing = isolated
        .transaction(|context| Box::pin(count(context)))
        .await;
    assert!(matches!(missing, Err(StoreError::Database(_))));
}

#[tokio::test(flavor = "multi_thread")]
async fn cancellation_before_commit_discards_the_session_and_rolls_back() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("cancel.sqlite");
    let mut session = Session::open(&path).await.unwrap();
    initialize(&mut session).await;
    let (written, ready) = oneshot::channel();
    {
        let transaction = session.transaction::<(), StoreError, _>(move |context| {
            Box::pin(async move {
                context
                    .connection()
                    .batch_execute("INSERT INTO notes VALUES (2, 'abandoned')")
                    .await?;
                written.send(()).unwrap();
                pending().await
            })
        });
        tokio::pin!(transaction);
        timeout(Duration::from_secs(5), async {
            tokio::select! {
                result = &mut transaction => panic!("unexpected completion: {result:?}"),
                ready = ready => ready.unwrap(),
            }
        })
        .await
        .unwrap();
    }
    assert!(!session.is_usable());
    assert!(matches!(
        session
            .transaction(|context| Box::pin(count(context)))
            .await,
        Err(StoreError::Discarded)
    ));
    let mut reopened = Session::open(&path).await.unwrap();
    assert_eq!(
        timeout(
            Duration::from_secs(5),
            reopened.transaction(|context| Box::pin(count(context)))
        )
        .await
        .unwrap()
        .unwrap(),
        1
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn caught_savepoint_cancellation_cannot_commit_partial_work() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("savepoint.sqlite");
    let mut session = Session::open(&path).await.unwrap();
    initialize(&mut session).await;
    let result =
        session
            .transaction::<(), StoreError, _>(|context| {
                Box::pin(async move {
                    let (written, ready) = oneshot::channel();
                    {
                        let savepoint = context.savepoint::<(), StoreError, _>(move |context| {
                            Box::pin(async move {
                                context
                                    .connection()
                                    .batch_execute("INSERT INTO notes VALUES (2, 'abandoned')")
                                    .await?;
                                written.send(()).unwrap();
                                pending().await
                            })
                        });
                        tokio::pin!(savepoint);
                        timeout(Duration::from_secs(5), async {
                tokio::select! {
                    result = &mut savepoint => panic!("unexpected completion: {result:?}"),
                    ready = ready => ready.unwrap(),
                }
            }).await.unwrap();
                    }
                    // Intentionally swallow the canceled participant and try to commit.
                    Ok(())
                })
            })
            .await;
    assert!(matches!(result, Err(StoreError::Poisoned)));
    assert!(!session.is_usable());
    let mut reopened = Session::open(&path).await.unwrap();
    assert_eq!(
        reopened
            .transaction(|context| Box::pin(count(context)))
            .await
            .unwrap(),
        1
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn savepoint_rejection_can_be_caught_without_partial_domain_writes() {
    let mut session = Session::memory().await.unwrap();
    initialize(&mut session).await;
    session
        .transaction::<(), StoreError, _>(|context| {
            Box::pin(async move {
                let failed = context
                    .savepoint::<(), StoreError, _>(|context| {
                        Box::pin(async move {
                            context
                                .connection()
                                .batch_execute("INSERT INTO notes VALUES (2, 'rolled back')")
                                .await?;
                            context
                                .savepoint::<(), StoreError, _>(|context| {
                                    Box::pin(async move {
                                        context
                                            .connection()
                                            .batch_execute(
                                                "INSERT INTO notes VALUES (3, 'also rolled back')",
                                            )
                                            .await?;
                                        Ok(())
                                    })
                                })
                                .await?;
                            Err(StoreError::Poisoned)
                        })
                    })
                    .await;
                assert!(failed.is_err());
                assert_eq!(count(context).await?, 1);
                context
                    .connection()
                    .batch_execute("INSERT INTO notes VALUES (4, 'outer committed')")
                    .await?;
                Ok(())
            })
        })
        .await
        .unwrap();
    assert_eq!(
        session
            .transaction(|context| Box::pin(count(context)))
            .await
            .unwrap(),
        2
    );
}

#[tokio::test]
async fn current_thread_runtime_is_rejected_before_entering_the_driver() {
    assert!(matches!(
        Session::memory().await,
        Err(StoreError::UnsupportedRuntime)
    ));
}

#[test]
fn missing_runtime_is_rejected_without_creating_one() {
    use std::{
        future::Future,
        task::{Poll, Waker},
    };
    let mut context = std::task::Context::from_waker(Waker::noop());
    let mut future = Box::pin(Session::memory());
    assert!(matches!(
        future.as_mut().poll(&mut context),
        Poll::Ready(Err(StoreError::UnsupportedRuntime))
    ));
}
#[tokio::test(flavor = "multi_thread")]
async fn caught_nested_savepoint_cancellation_poison_survives_outer_cleanup() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("nested-cancel.sqlite");
    let mut session = Session::open(&path).await.unwrap();
    initialize(&mut session).await;
    let result = session.transaction::<(), StoreError, _>(|context| Box::pin(async move {
        let outer = context.savepoint::<(), StoreError, _>(|context| Box::pin(async move {
            let (written, ready) = oneshot::channel();
            {
                let inner = context.savepoint::<(), StoreError, _>(move |context| Box::pin(async move {
                    context.connection().batch_execute("INSERT INTO notes VALUES (2, 'canceled nested write')").await?;
                    written.send(()).unwrap();
                    pending().await
                }));
                tokio::pin!(inner);
                timeout(Duration::from_secs(5), async {
                    tokio::select! {
                        result = &mut inner => panic!("unexpected completion: {result:?}"),
                        ready = ready => ready.unwrap(),
                    }
                }).await.unwrap();
            }
            Ok(())
        })).await;
        assert!(matches!(outer, Err(StoreError::Poisoned)));
        Ok(())
    })).await;
    assert!(matches!(result, Err(StoreError::Poisoned)));
    assert!(!session.is_usable());
    let mut reopened = Session::open(&path).await.unwrap();
    assert_eq!(
        reopened
            .transaction(|context| Box::pin(count(context)))
            .await
            .unwrap(),
        1
    );
}
