use crate::{AttemptFailure, FailureCode, MediaStorage};
use std::{
    ffi::OsString,
    path::Path,
    process::{ExitStatus, Stdio},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::{Child, Command},
    sync::{OwnedSemaphorePermit, oneshot},
};

async fn drain(
    mut reader: impl AsyncRead + Unpin,
    limit: usize,
) -> Result<Vec<u8>, AttemptFailure> {
    let mut bytes = Vec::new();
    let mut buffer = [0; 8192];
    loop {
        let count = reader
            .read(&mut buffer)
            .await
            .map_err(|e| AttemptFailure::new(FailureCode::ToolFailure, e))?;
        if count == 0 {
            return Ok(bytes);
        }
        if count > limit.saturating_sub(bytes.len()) {
            return Err(AttemptFailure::new(
                FailureCode::Limit,
                "subprocess output budget",
            ));
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
}
/// The supervisor owns its child through termination and wait, including when its
/// request receiver disappears. Its completion value is actual child disposition.
async fn supervise(
    mut child: Child,
    mut sender: oneshot::Sender<Result<Vec<u8>, AttemptFailure>>,
    timeout: Duration,
    output_limit: usize,
    _permit: OwnedSemaphorePermit,
) -> std::io::Result<ExitStatus> {
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let result = match (stdout, stderr) {
        (Some(stdout), Some(stderr)) => tokio::select! {
            _=sender.closed() => Err(AttemptFailure::new(FailureCode::Worker,"caller cancelled")),
            _=tokio::time::sleep(timeout) => Err(AttemptFailure::new(FailureCode::Timeout,"subprocess deadline")),
            result=async {
                let (out,err,status)=tokio::try_join!(drain(stdout,output_limit),drain(stderr,64*1024),async { child.wait().await.map_err(|e|AttemptFailure::new(FailureCode::ToolFailure,e)) })?;
                if !status.success() { return Err(AttemptFailure::new(FailureCode::ToolFailure,format!("{status}: {}",String::from_utf8_lossy(&err)))); }
                Ok(out)
            } => result,
        },
        _ => Err(AttemptFailure::new(
            FailureCode::ToolFailure,
            "capture pipe missing",
        )),
    };
    if result.is_err() {
        let _ = child.start_kill();
    }
    // Tokio caches status, so this also confirms successful children were reaped.
    let disposition = child.wait().await;
    if let Err(error) = &disposition {
        let _ = sender.send(Err(AttemptFailure::new(
            FailureCode::ToolFailure,
            format!("reap failed: {error}"),
        )));
    } else {
        let _ = sender.send(result);
    }
    disposition
}

pub(crate) async fn run(
    storage: &MediaStorage,
    program: &Path,
    args: Vec<OsString>,
    output_limit: usize,
) -> Result<Vec<u8>, AttemptFailure> {
    let permit = storage
        .workers
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| AttemptFailure::new(FailureCode::Worker, e))?;
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let child = command.spawn().map_err(|e| {
        AttemptFailure::new(
            if e.kind() == std::io::ErrorKind::NotFound {
                FailureCode::ToolUnavailable
            } else {
                FailureCode::ToolFailure
            },
            e,
        )
    })?;
    let (sender, receiver) = oneshot::channel();
    // No await between spawn and transferring ownership to the supervisor.
    tokio::spawn(supervise(
        child,
        sender,
        storage.config.process_timeout,
        output_limit,
        permit,
    ));
    receiver
        .await
        .map_err(|e| AttemptFailure::new(FailureCode::Worker, e))?
}

#[cfg(test)]
#[path = "process_tests.rs"]
mod tests;
