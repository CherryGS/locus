use super::*;
use std::sync::Arc;
use tokio::sync::Semaphore;
fn helper(name: &str) -> Child {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args(["--ignored", "--exact", name, "--nocapture"])
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
            "process::tests::helper_wait",
            Duration::from_millis(100),
            FailureCode::Timeout,
        ),
        (
            "process::tests::helper_output",
            Duration::from_secs(10),
            FailureCode::Limit,
        ),
    ] {
        let semaphore = Arc::new(Semaphore::new(1));
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let (sender, receiver) = oneshot::channel();
        let supervisor = tokio::spawn(supervise(helper(name), sender, timeout, 1024, permit));
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
        helper("process::tests::helper_wait"),
        sender,
        Duration::from_secs(30),
        1024,
        permit,
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
