#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::{
    io::Write,
    process::{Command, Stdio},
};

#[test]
fn real_binary_rejects_bad_bootstrap_and_startup_failure_without_readiness_or_secret() {
    let root = tempfile::tempdir().unwrap();
    let blocked = root.path().join("not-a-directory");
    std::fs::write(&blocked, b"file").unwrap();
    let credential = "never-print-this-private-temporary-credential";
    let inputs = [
        br#"{"credential":"secret"}"#.to_vec(),
        vec![b'x'; 16385],
        serde_json::to_vec(&serde_json::json!({"credential":credential,"library_root":blocked}))
            .unwrap(),
    ];
    for input in inputs {
        let mut child = Command::new(env!("CARGO_BIN_EXE_locus-server"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(&input).unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        assert!(!String::from_utf8_lossy(&output.stderr).contains(credential));
        assert!(!String::from_utf8_lossy(&output.stderr).contains("secret"));
    }
}

#[test]
fn real_schema_export_does_not_initialize_storage_or_read_bootstrap() {
    let root = tempfile::tempdir().unwrap();
    let library = root.path().join("must-not-exist");
    let schema = root.path().join("openapi.json");
    let output = Command::new(env!("CARGO_BIN_EXE_locus-server"))
        .args([std::ffi::OsStr::new("export-openapi"), schema.as_os_str()])
        .env("LOCUS_DATA_DIR", &library)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(output.stdout.is_empty());
    assert!(schema.is_file());
    assert!(!library.exists());
}
