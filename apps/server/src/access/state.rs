use super::persistence::Credential;
use crate::api::external::dto::ExternalRuntime;
use std::sync::{Mutex, MutexGuard};
use tokio::sync::watch;

pub(crate) struct AccessState {
    #[cfg(test)]
    pub reset_fault: Mutex<Option<ResetFault>>,
    #[cfg(test)]
    pub pause_event: Mutex<
        Option<(
            std::sync::Arc<tokio::sync::Notify>,
            std::sync::Arc<tokio::sync::Notify>,
        )>,
    >,
    pub operation: tokio::sync::Mutex<()>,
    inner: Mutex<CredentialState>,
    pub changed: watch::Sender<u64>,
    pub runtime: Mutex<ExternalRuntime>,
}
#[cfg(test)]
#[derive(Clone, Copy)]
pub(crate) enum ResetFault {
    Rollback,
    Unknown,
    PanicAfterCommit,
}
pub(crate) struct CredentialState {
    pub current: Option<Credential>,
    pub problem: Option<String>,
    pub epoch: u64,
}
impl AccessState {
    pub fn new(credential: anyhow::Result<Credential>, runtime: ExternalRuntime) -> Self {
        let (current, problem) = match credential {
            Ok(v) => (Some(v), None),
            Err(_) => (
                None,
                Some("Retained external credential could not be established".into()),
            ),
        };
        Self {
            #[cfg(test)]
            reset_fault: Mutex::new(None),
            #[cfg(test)]
            pause_event: Mutex::new(None),
            operation: tokio::sync::Mutex::new(()),
            inner: Mutex::new(CredentialState {
                current,
                problem,
                epoch: 0,
            }),
            changed: watch::channel(0).0,
            runtime: Mutex::new(runtime),
        }
    }
    pub fn lock(&self) -> MutexGuard<'_, CredentialState> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
    pub fn establish(&self, value: anyhow::Result<Credential>) {
        let mut state = self.lock();
        if let Ok(incoming) = &value
            && state
                .current
                .as_ref()
                .is_some_and(|current| current.revision == incoming.revision)
        {
            return;
        }
        match value {
            Ok(value) => {
                state.current = Some(value);
                state.problem = None
            }
            Err(_) => {
                state.current = None;
                state.problem = Some(
                    "Current credential is unconfirmed; recover the original operation and reread"
                        .into(),
                )
            }
        }
        state.epoch += 1;
        self.changed.send_replace(state.epoch);
    }
}
