use super::{Server, ServerConfig, StartupFailure, ownership::LibraryOwnership};
use locus_task::api::TaskContext;
use std::{path::Path, sync::Arc};

pub(crate) struct StartupProbe {
    pub entered: Arc<tokio::sync::Notify>,
    pub release: std::sync::mpsc::Receiver<()>,
    pub fail: bool,
}
impl StartupProbe {
    pub async fn run(self, task: &TaskContext, root: &Path) -> anyhow::Result<()> {
        let marker = root.join("startup-worker-finished");
        let fail = self.fail;
        let stage = task.enter("Protected startup fixture", &[]).await?;
        let worker = stage.spawn_blocking(move |_| {
            self.entered.notify_one();
            self.release.recv()?;
            std::fs::write(marker, b"actual initializer ended")?;
            Ok::<_, anyhow::Error>(())
        });
        drop(stage);
        if fail {
            // The initializer body ends before its protected worker. Queue
            // completion, not the body's return or caller's wait, owns release.
            drop(worker);
            anyhow::bail!("Injected initialization failure with a protected writer");
        }
        worker.await??;
        Ok(())
    }
}
fn config(root: &Path) -> ServerConfig {
    let mut config = ServerConfig::new(
        "ownership-test-private-credential".into(),
        root.to_path_buf(),
    );
    config.external_address_override = Some("127.0.0.1:0".parse().unwrap());
    config
}
async fn occupied(root: &Path) {
    let error = Server::bind(config(root))
        .await
        .err()
        .expect("Second runtime must be refused");
    let failure = StartupFailure::from_error(&error).expect("Specific private failure reason");
    assert_eq!(
        serde_json::to_string(&failure).unwrap(),
        r#"{"startup_error":"library_in_use"}"#
    );
}
async fn eventually_open(root: &Path) -> Server {
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            match Server::bind(config(root)).await {
                Ok(server) => break server,
                Err(error) => {
                    assert!(StartupFailure::from_error(&error).is_some(), "{error:#}");
                    tokio::task::yield_now().await;
                }
            }
        }
    })
    .await
    .unwrap()
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn aliases_drain_and_distinct_libraries_preserve_exclusive_runtime_ownership() {
    let root = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    let server = Server::bind(config(root.path())).await.unwrap();
    occupied(root.path()).await;
    occupied(&root.path().join(".")).await;
    let independent = Server::bind(config(other.path())).await.unwrap();
    server.close_admission();
    server.state.wait_drained().await;
    occupied(root.path()).await;
    let router = server.router();
    drop(server);
    // A retained router is still an operational runtime handle, not evidence
    // that the owning backend has ended.
    occupied(root.path()).await;
    drop(router);
    drop(eventually_open(root.path()).await);
    drop(independent);
    assert!(root.path().join(".locus-runtime.lock").is_file());
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn lost_startup_waiter_and_failed_initialization_keep_the_guard_until_actual_writer_ends() {
    for fail in [false, true] {
        let root = tempfile::tempdir().unwrap();
        let entered = Arc::new(tokio::sync::Notify::new());
        let (release, waiting) = std::sync::mpsc::channel();
        let mut options = config(root.path());
        options.startup_probe = Some(StartupProbe {
            entered: entered.clone(),
            release: waiting,
            fail,
        });
        let startup = tokio::spawn(Server::bind(options));
        tokio::time::timeout(std::time::Duration::from_secs(5), entered.notified())
            .await
            .unwrap();
        assert!(!startup.is_finished());
        startup.abort();
        assert!(startup.await.is_err());
        occupied(root.path()).await;
        assert!(!root.path().join("startup-worker-finished").exists());
        release.send(()).unwrap();
        let reopened = eventually_open(root.path()).await;
        assert_eq!(
            std::fs::read(root.path().join("startup-worker-finished")).unwrap(),
            b"actual initializer ended"
        );
        drop(reopened);
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn dropped_runtime_and_operation_waiter_do_not_release_a_protected_accepted_worker() {
    let root = tempfile::tempdir().unwrap();
    let server = Server::bind(config(root.path())).await.unwrap();
    let entered = Arc::new(tokio::sync::Notify::new());
    let waiting = entered.clone();
    let (release, receiver) = std::sync::mpsc::channel();
    let marker = root.path().join("accepted-worker-finished");
    let result = server
        .state
        .direct("Protected accepted fixture", move |task| async move {
            let stage = task.enter("Write fixture bytes", &[]).await.unwrap();
            drop(stage.spawn_blocking(move |_| {
                waiting.notify_one();
                receiver.recv().unwrap();
                std::fs::write(marker, b"done").unwrap();
            }));
        })
        .unwrap();
    entered.notified().await;
    server.close_admission();
    assert_eq!(server.state.status().active_operations, "1");
    occupied(root.path()).await;
    drop(result);
    drop(server);
    occupied(root.path()).await;
    release.send(()).unwrap();
    let reopened = eventually_open(root.path()).await;
    assert_eq!(
        std::fs::read(root.path().join("accepted-worker-finished")).unwrap(),
        b"done"
    );
    drop(reopened);
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn construction_and_ownership_io_failures_release_without_false_conflict_or_replacement() {
    let root = tempfile::tempdir().unwrap();
    let mut options = config(root.path());
    options.renderer_root = Some(root.path().join("absent-renderer"));
    let error = Server::bind(options).await.err().unwrap();
    assert!(StartupFailure::from_error(&error).is_none());
    drop(eventually_open(root.path()).await);
    let other = tempfile::tempdir().unwrap();
    std::fs::create_dir(other.path().join(".locus-runtime.lock")).unwrap();
    let error = Server::bind(config(other.path())).await.err().unwrap();
    assert!(StartupFailure::from_error(&error).is_none());
    assert!(!other.path().join("metadata.sqlite").exists());
    let missing = other.path().join("intended-missing");
    let mut options = config(&missing);
    options.require_existing = true;
    assert!(Server::bind(options).await.is_err());
    assert!(!missing.exists());
}
#[test]
fn ownership_sidecar_is_not_truncated_and_tool_children_do_not_inherit_the_claim() {
    use std::io::{BufRead, Write};
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join(".locus-runtime.lock");
    std::fs::write(&path, b"retained sidecar, not a PID lease").unwrap();
    let owner = LibraryOwnership::acquire(root.path(), false).unwrap();
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--ignored",
            "--exact",
            "runtime::ownership_tests::lock_handle_child",
            "--nocapture",
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let mut output = std::io::BufReader::new(child.stdout.take().unwrap());
    loop {
        let mut line = String::new();
        assert!(output.read_line(&mut line).unwrap() > 0);
        if line.contains("ownership-child-ready") {
            break;
        }
    }
    drop(owner);
    let next = LibraryOwnership::acquire(root.path(), false).unwrap();
    assert!(child.try_wait().unwrap().is_none());
    drop(next);
    child.stdin.take().unwrap().write_all(b"finish\n").unwrap();
    assert!(child.wait().unwrap().success());
    assert_eq!(
        std::fs::read(path).unwrap(),
        b"retained sidecar, not a PID lease"
    );
}
#[test]
#[ignore = "private child-process ownership fixture"]
fn lock_handle_child() {
    use std::io::Write;
    println!("ownership-child-ready");
    std::io::stdout().flush().unwrap();
    let mut line = String::new();
    std::io::stdin().read_line(&mut line).unwrap();
}
