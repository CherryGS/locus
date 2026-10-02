use super::{
    record::SearchStatus,
    state::{Command, Shared},
};
use crate::{error::SearchError, projection::Providers, schema::Mapping};
use locus_core::api::Kernel;
use locus_store::api::{Context, TaskDatabase, TransactionFuture};
use locus_task::api::TaskQueue;
use std::{
    path::PathBuf,
    sync::{
        Arc, Weak,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::sync::mpsc;

#[derive(Clone)]
pub(super) struct Worker {
    pub(super) stopping: Arc<AtomicBool>,
    pub(super) done: tokio::sync::watch::Sender<bool>,
    pub(super) shared: Arc<Shared>,
    pub(super) mapping: Arc<Mapping>,
    pub(super) providers: Providers,
    pub(super) root: PathBuf,
    pub(super) queue: TaskQueue,
    pub(super) database: TaskDatabase,
    pub(super) kernel: Kernel,
    pub(super) _lifetime: Arc<dyn Send + Sync>,
}
impl Worker {
    #[cfg(test)]
    pub(super) fn fault(&self, phase: u8) -> Result<(), SearchError> {
        if self
            .shared
            .fault
            .compare_exchange(phase, 0, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            Err(SearchError::Invalid(format!("injected phase {phase}")))
        } else {
            Ok(())
        }
    }
    pub(super) async fn db<T, F>(&self, f: F) -> Result<T, SearchError>
    where
        T: Send + 'static,
        F: for<'a> FnOnce(&'a mut Context) -> TransactionFuture<'a, T, SearchError>
            + Send
            + 'static,
    {
        let database = self.database.clone();
        self.queue
            .submit("Search projection", move |task| async move {
                let mut session = database.session(&task).await?;
                session.transaction(f).await
            })?
            .result()
            .await?
    }
    pub(super) fn check_stop(&self) -> Result<(), SearchError> {
        if self.stopping.load(Ordering::SeqCst) {
            Err(SearchError::Unavailable("worker stopping".into()))
        } else {
            Ok(())
        }
    }
    pub(super) fn lease(&self, generation: &str) -> Arc<()> {
        let lease = Arc::new(());
        self.shared
            .generations
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(generation.into(), Arc::downgrade(&lease));
        lease
    }
    fn reclaim(&self) {
        self.shared
            .discoveries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|_, c| c.expires > Instant::now());
        self.shared
            .contexts
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|_, c| c.expires > Instant::now());
        let generations = self
            .shared
            .generations
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let current = std::fs::read_to_string(self.root.join("current")).ok();
        if let Ok(entries) = std::fs::read_dir(&self.root) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if uuid::Uuid::parse_str(&name).is_ok()
                    && Some(&name) != current.as_ref()
                    && generations.get(&name).and_then(Weak::upgrade).is_none()
                {
                    let _ = std::fs::remove_dir_all(entry.path());
                }
            }
        }
    }
    pub(super) fn status(&self, change: impl FnOnce(&mut SearchStatus)) {
        change(
            &mut self
                .shared
                .status
                .write()
                .unwrap_or_else(|e| e.into_inner()),
        );
    }
    pub(super) async fn run(self, mut commands: mpsc::UnboundedReceiver<Command>) {
        let mut rebuild = false;
        let mut active = true;
        loop {
            self.reclaim();
            if self.stopping.load(Ordering::SeqCst) {
                break;
            }
            if active {
                if let Err(error) = self.maintain(rebuild).await {
                    self.status(|s| {
                        s.state = "failed".into();
                        s.failure = Some(error.to_string());
                    });
                    active = false;
                }
                rebuild = false;
            }
            tokio::select! {
            command=commands.recv()=>match command{Some(Command::Observe(reply))=>{let result=self.observe().await;let _=reply.send(result);},Some(Command::Retry)=>active=true,Some(Command::Rebuild)=>{active=true;rebuild=true;},Some(Command::Query(program,typed,reply))=>{let result=self.admit(*program,typed).await;let _=reply.send(result);},Some(Command::Stop(reply))=>{let _=reply.send(());break},None=>break},
            _=tokio::time::sleep(Duration::from_millis(250))=>{},
            }
        }
        self.done.send_replace(true);
    }
}
