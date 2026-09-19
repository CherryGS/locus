#![allow(clippy::expect_used, clippy::unwrap_used)]
use locus_task::api::{TaskError, TaskHandle, TaskQueue, TaskState};
use std::{future::Future, time::Duration};
use tokio::sync::oneshot;

async fn bounded<T>(future: impl Future<Output = T>) -> T {
    tokio::time::timeout(Duration::from_secs(10), future)
        .await
        .unwrap()
}

async fn state<T>(handle: &TaskHandle<T>, expected: TaskState) {
    let mut changes = handle.subscribe();
    bounded(async {
        loop {
            if changes.borrow_and_update().state == expected {
                return;
            }
            changes.changed().await.unwrap();
        }
    })
    .await;
}

#[tokio::test]
async fn atomic_sets_deduplicate_skip_blocked_and_release_all_keys() {
    bounded(async {
        let q = TaskQueue::new();
        let a = q.resource();
        let b = q.resource();
        let c = q.resource();
        let (release, held) = oneshot::channel();
        let a1 = a.clone();
        let holder = q
            .submit("hold A", move |task| async move {
                let _stage = task.enter("A", &[a1]).await.unwrap();
                held.await.unwrap();
            })
            .unwrap();
        state(&holder, TaskState::Running).await;
        let a2 = a.clone();
        let b2 = b.clone();
        let blocked = q
            .submit("AB", move |task| async move {
                let _stage = task.enter("AB", &[a2.clone(), b2, a2]).await.unwrap();
                42
            })
            .unwrap();
        state(&blocked, TaskState::Waiting).await;
        // AB waiting must not retain B. Also exercise disjoint/empty stages.
        let other = q
            .submit("BC", move |task| async move {
                drop(task.enter("BC", &[b, c]).await.unwrap());
                drop(task.enter("empty", &[]).await.unwrap());
            })
            .unwrap();
        other.result().await.unwrap();
        assert_eq!(blocked.snapshot().state, TaskState::Waiting);
        release.send(()).unwrap();
        holder.result().await.unwrap();
        assert_eq!(blocked.result().await.unwrap(), 42);
        q.submit("released", move |task| async move {
            task.enter("A", &[a]).await.unwrap();
        })
        .unwrap()
        .result()
        .await
        .unwrap();
    })
    .await;
}

#[tokio::test]
async fn submitted_eligible_continuation_precedes_already_waiting_fresh_work() {
    bounded(async {
        let q = TaskQueue::new();
        let key = q.resource();
        let (release, wait) = oneshot::channel();
        let k = key.clone();
        let holder = q
            .submit("holder", move |t| async move {
                let _s = t.enter("held", &[k]).await.unwrap();
                wait.await.unwrap();
            })
            .unwrap();
        state(&holder, TaskState::Running).await;
        let (events, mut received) = tokio::sync::mpsc::unbounded_channel();
        let e = events.clone();
        let k = key.clone();
        let fresh = q
            .submit("fresh", move |t| async move {
                let _s = t.enter("fresh", &[k]).await.unwrap();
                e.send("fresh").unwrap();
            })
            .unwrap();
        state(&fresh, TaskState::Waiting).await;
        let continuation = q
            .submit("continuation", move |t| async move {
                drop(t.enter("first", &[]).await.unwrap());
                let _s = t.enter("dynamic next", &[key]).await.unwrap();
                events.send("continuation").unwrap();
            })
            .unwrap();
        state(&continuation, TaskState::Waiting).await;
        release.send(()).unwrap();
        assert_eq!(received.recv().await, Some("continuation"));
        assert_eq!(received.recv().await, Some("fresh"));
        holder.result().await.unwrap();
        continuation.result().await.unwrap();
        fresh.result().await.unwrap();
    })
    .await;
}

#[tokio::test]
async fn foreign_nested_failure_and_panic_do_not_strand_resources() {
    bounded(async {
        let q = TaskQueue::new();
        let key = q.resource();
        let foreign = TaskQueue::new().resource();
        let k = key.clone();
        let task = q
            .submit("errors", move |t| async move {
                assert!(matches!(
                    t.enter("foreign", &[foreign]).await,
                    Err(TaskError::ForeignResource)
                ));
                let s = t.enter("first", &[k]).await.unwrap();
                assert!(matches!(
                    t.enter("nested", &[]).await,
                    Err(TaskError::NestedStage)
                ));
                drop(s);
                let result = t
                    .run("stage failure", &[], |_| async {
                        Err::<(), _>("domain conflict")
                    })
                    .await
                    .unwrap();
                assert_eq!(result, Err("domain conflict"));
                assert!(matches!(
                    t.run("stage panic", &[], |_| async { panic!("stage panic") })
                        .await,
                    Err(TaskError::Worker(_))
                ));
                panic!("body panic");
            })
            .unwrap();
        assert!(matches!(task.result().await, Err(TaskError::Worker(_))));
        q.submit("after panic", move |t| async move {
            t.enter("key", &[key]).await.unwrap();
        })
        .unwrap()
        .result()
        .await
        .unwrap();
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn dropped_observer_preserves_body_and_live_progress() {
    bounded(async {
        let q = TaskQueue::new();
        let (started, ready) = oneshot::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let (completed, done) = oneshot::channel();
        let task = q
            .submit("copy", move |t| async move {
                t.run("worker", &[], move |stage| async move {
                    stage
                        .spawn_blocking(move |stage| {
                            stage.progress(Some(7), Some(11), "active bytes");
                            started.send(()).unwrap();
                            wait.recv().unwrap();
                        })
                        .await
                        .unwrap();
                })
                .await
                .unwrap();
                completed.send(23).unwrap();
            })
            .unwrap();
        ready.await.unwrap();
        let snapshot = task.snapshot();
        assert_eq!(snapshot.state, TaskState::Running);
        assert_eq!(snapshot.completed, Some(7));
        assert_eq!(snapshot.total, Some(11));
        drop(task);
        release.send(()).unwrap();
        assert_eq!(done.await.unwrap(), 23);
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn body_panic_waits_for_actual_blocking_work_before_completion_and_release() {
    bounded(async {
        let q = TaskQueue::new();
        let key = q.resource();
        let k = key.clone();
        let (started, ready) = oneshot::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let (panicked, panic_seen) = oneshot::channel();
        let task = q
            .submit("panic with worker", move |t| async move {
                let stage = t.enter("protected", &[k]).await.unwrap();
                let worker = stage.spawn_blocking(move |s| {
                    s.progress(Some(1), None, "still active");
                    started.send(()).unwrap();
                    wait.recv().unwrap();
                });
                drop(worker); // Dropping the JoinHandle must not release its lease.
                ready.await.unwrap();
                drop(stage);
                panicked.send(()).unwrap();
                panic!("outer body");
            })
            .unwrap();
        panic_seen.await.unwrap();
        let next = q
            .submit("next", move |t| async move {
                let _s = t.enter("key", &[key]).await.unwrap();
            })
            .unwrap();
        state(&next, TaskState::Waiting).await;
        assert_eq!(task.snapshot().state, TaskState::Running);
        release.send(()).unwrap();
        assert!(matches!(task.result().await, Err(TaskError::Worker(_))));
        next.result().await.unwrap();
    })
    .await;
}

#[tokio::test]
async fn cancelled_pending_stage_releases_request_and_context() {
    bounded(async {
        let q = TaskQueue::new();
        let key = q.resource();
        let k = key.clone();
        let (release, wait) = oneshot::channel();
        let holder = q
            .submit("holder", move |t| async move {
                let _s = t.enter("key", &[k]).await.unwrap();
                wait.await.unwrap();
            })
            .unwrap();
        state(&holder, TaskState::Running).await;
        let task = q
            .submit("cancel local wait", move |t| async move {
                let resources = [key];
                let mut pending = Box::pin(t.enter("blocked", &resources));
                assert!(
                    std::future::poll_fn(|cx| std::task::Poll::Ready(
                        pending.as_mut().poll(cx).is_pending()
                    ))
                    .await
                );
                drop(pending);
                t.enter("empty", &[]).await.unwrap();
            })
            .unwrap();
        task.result().await.unwrap();
        release.send(()).unwrap();
        holder.result().await.unwrap();
    })
    .await;
}

#[test]
fn submission_without_runtime_returns_start_error() {
    assert!(matches!(
        TaskQueue::new().submit("no runtime", |_| async {}),
        Err(TaskError::NoRuntime)
    ));
}

#[tokio::test]
async fn owned_stage_waits_for_children_before_returning_or_failing() {
    bounded(async {
        let queue = TaskQueue::new();
        let resource = queue.resource();
        queue
            .submit("sequential owned stages", move |task| async move {
                for panic_body in [false, true] {
                    let resources = [resource.clone()];
                    let (release, wait) = oneshot::channel();
                    let (returned, body_returned) = oneshot::channel();
                    let operation = task.run("parent with child", &resources, move |stage| async move {
                        drop(stage.spawn(move |_| async move {
                            wait.await.unwrap();
                        }));
                        returned.send(()).unwrap();
                        if panic_body {
                            panic!("stage body failed while its child was active");
                        }
                        27
                    });
                    tokio::pin!(operation);
                    // On this single-thread runtime the stage body finishes its poll
                    // after signaling. Poll its completion first: a returned value or
                    // panic must still wait for the independently held child lease.
                    tokio::select! {
                        biased;
                        result = &mut operation => panic!("stage returned before its child: {result:?}"),
                        result = body_returned => result.unwrap(),
                    }
                    release.send(()).unwrap();
                    let result = operation.await;
                    if panic_body {
                        assert!(matches!(result, Err(TaskError::Worker(_))));
                    } else {
                        assert_eq!(result.unwrap(), 27);
                    }
                    drop(task.enter("next stage", std::slice::from_ref(&resource)).await.unwrap());
                }
            })
            .unwrap()
            .result()
            .await
            .unwrap();
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn typed_completion_waits_for_a_worker_after_the_body_returns() {
    bounded(async {
        let queue = TaskQueue::new();
        let resource = queue.resource();
        let held = resource.clone();
        let (started, ready) = oneshot::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let handle = queue
            .submit("body returned", move |task| async move {
                let stage = task.enter("worker", &[held]).await.unwrap();
                drop(stage.spawn_blocking(move |_| {
                    started.send(()).unwrap();
                    wait.recv().unwrap();
                }));
                73
            })
            .unwrap();
        ready.await.unwrap();
        let next = queue
            .submit("next", move |task| async move {
                task.enter("resource", &[resource]).await.unwrap();
            })
            .unwrap();
        state(&next, TaskState::Waiting).await;
        assert_eq!(handle.snapshot().state, TaskState::Running);
        release.send(()).unwrap();
        assert_eq!(handle.result().await.unwrap(), 73);
        next.result().await.unwrap();
    })
    .await;
}
