use super::command::supervise;
use crate::error::FailureCode;
use std::sync::Arc;
use std::{process::Stdio, time::Duration};
use tokio::sync::Semaphore;
use tokio::{
    process::{Child, Command},
    sync::oneshot,
};
fn helper(name: &str) -> Child {
    // module_path! includes the crate name; libtest's exact names start below it.
    let (_, test_name) = name.split_once("::").unwrap();
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args(["--ignored", "--exact", test_name, "--nocapture"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    command.spawn().unwrap()
}
#[test]
#[ignore = "private child-process fixture"]
fn helper_wait() {
    std::thread::sleep(Duration::from_secs(600));
}
#[test]
#[ignore = "private child-process fixture"]
fn helper_output() {
    use std::io::Write;
    let bytes = vec![b'x'; 2 * 1024 * 1024];
    let _ = std::io::stdout().write_all(&bytes);
    std::thread::sleep(Duration::from_secs(600));
}
#[tokio::test(flavor = "multi_thread")]
async fn timeout_and_output_limit_kill_and_reap_owned_child() {
    for (name, timeout, expected) in [
        (
            concat!(module_path!(), "::helper_wait"),
            Duration::from_millis(100),
            FailureCode::Timeout,
        ),
        (
            concat!(module_path!(), "::helper_output"),
            Duration::from_secs(10),
            FailureCode::Limit,
        ),
    ] {
        let semaphore = Arc::new(Semaphore::new(1));
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let (sender, receiver) = oneshot::channel();
        let supervisor = tokio::spawn(supervise(helper(name), sender, timeout, 1024, permit, None));
        assert_eq!(receiver.await.unwrap().unwrap_err().code, expected);
        assert!(!supervisor.await.unwrap().unwrap().success());
        assert_eq!(semaphore.available_permits(), 1);
    }
}
#[tokio::test(flavor = "multi_thread")]
async fn cancelled_request_supervisor_finishes_reaping() {
    let semaphore = Arc::new(Semaphore::new(1));
    let permit = semaphore.clone().acquire_owned().await.unwrap();
    let (sender, receiver) = oneshot::channel();
    let supervisor = tokio::spawn(supervise(
        helper(concat!(module_path!(), "::helper_wait")),
        sender,
        Duration::from_secs(30),
        1024,
        permit,
        None,
    ));
    drop(receiver);
    let status = tokio::time::timeout(Duration::from_secs(10), supervisor)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(!status.success());
    assert_eq!(semaphore.available_permits(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn task_observer_drop_preserves_child_lease_through_reaping() {
    use locus_task::api::{TaskQueue, TaskState};
    tokio::time::timeout(Duration::from_secs(10), async {
        let queue = TaskQueue::new();
        let resource = queue.resource();
        let held = resource.clone();
        let (started, ready) = oneshot::channel();
        let (cancel, canceled) = oneshot::channel();
        let (finished, reaped) = oneshot::channel();
        let task = queue
            .submit("child", move |task| async move {
                let stage = task.enter("child supervisor", &[held]).await.unwrap();
                let semaphore = Arc::new(Semaphore::new(1));
                let permit = semaphore.clone().acquire_owned().await.unwrap();
                let (sender, receiver) = oneshot::channel();
                let supervisor = tokio::spawn(supervise(
                    helper(concat!(module_path!(), "::helper_wait")),
                    sender,
                    Duration::from_secs(30),
                    1024,
                    permit,
                    Some(stage.clone()),
                ));
                drop(stage);
                started.send(()).unwrap();
                canceled.await.unwrap();
                drop(receiver);
                let status = supervisor.await.unwrap().unwrap();
                assert!(!status.success());
                assert_eq!(semaphore.available_permits(), 1);
                finished.send(()).unwrap();
            })
            .unwrap();
        ready.await.unwrap();
        let next = queue
            .submit("after child", move |task| async move {
                task.enter("resource", &[resource]).await.unwrap();
            })
            .unwrap();
        let mut changes = next.subscribe();
        loop {
            if changes.borrow_and_update().state == TaskState::Waiting {
                break;
            }
            changes.changed().await.unwrap();
        }
        assert_eq!(task.snapshot().state, TaskState::Running);
        drop(task);
        cancel.send(()).unwrap();
        reaped.await.unwrap();
        next.result().await.unwrap();
    })
    .await
    .unwrap();
}
