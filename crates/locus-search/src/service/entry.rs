use super::{
    record::{QueryContext, SearchRequest, SearchResult, SearchStatus},
    state::{Command, Control, Shared},
    worker::Worker,
};
use crate::{error::SearchError, projection::Providers, schema::Mapping};
use locus_core::api::Kernel;
use locus_query::api::{Catalogue, Program, Provider};
use locus_store::api::TaskDatabase;
use locus_task::api::TaskQueue;
use std::{
    collections::HashMap,
    path::Path,
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
};
use tokio::sync::{mpsc, oneshot};

#[derive(Clone)]
pub struct SearchService {
    pub(crate) mapping: Arc<Mapping>,
    pub(crate) catalogue: Catalogue,
    shared: Arc<Shared>,
    references: crate::reference::ReferenceReader,
    control: Arc<Control>,
}
impl SearchService {
    /// Lifetime is retained through worker and writer completion, including abandoned startup.
    pub fn start(
        root: &Path,
        queue: TaskQueue,
        database: TaskDatabase,
        kernel: Kernel,
        providers: Vec<Arc<dyn Provider>>,
        lifetime: Arc<dyn Send + Sync>,
    ) -> Result<Self, SearchError> {
        let providers = Providers::new(providers)?;
        let mapping = Arc::new(Mapping::new(&providers.catalogue)?);
        let shared = Arc::new(Shared {
            #[cfg(test)]
            fault: std::sync::atomic::AtomicU8::new(0),
            #[cfg(test)]
            build_pause: Mutex::new(None),
            #[cfg(test)]
            admission_pause: Mutex::new(None),
            generations: Mutex::new(HashMap::new()),
            publication: RwLock::new(None),
            status: RwLock::new(SearchStatus {
                state: "preparing".into(),
                usable: false,
                generation: None,
                covered_sequence: "0".into(),
                journal_head: "0".into(),
                completed: "0".into(),
                total: None,
                failure: None,
                document_count: None,
                segment_bytes: None,
            }),
            contexts: Mutex::new(HashMap::new()),
            discoveries: Mutex::new(HashMap::new()),
        });
        let (commands, receiver) = mpsc::unbounded_channel();
        let stopping = Arc::new(AtomicBool::new(false));
        let (done, done_rx) = tokio::sync::watch::channel(false);
        let references = crate::reference::ReferenceReader {
            providers: providers.clone(),
            queue: queue.clone(),
            database: database.clone(),
            lifetime: lifetime.clone(),
        };
        let worker = Worker {
            stopping: stopping.clone(),
            done,
            shared: shared.clone(),
            mapping: mapping.clone(),
            providers: providers.clone(),
            root: root.join("cache/search"),
            queue,
            database,
            kernel,
            _lifetime: lifetime,
        };
        tokio::spawn(worker.run(receiver));
        Ok(Self {
            mapping,
            catalogue: providers.catalogue,
            shared,
            references,
            control: Arc::new(Control {
                commands,
                stopping,
                done: done_rx,
            }),
        })
    }
    pub fn catalogue(&self) -> &Catalogue {
        &self.catalogue
    }
    #[cfg(test)]
    pub(crate) fn fail_once(&self, phase: u8) {
        self.shared.fault.store(phase, Ordering::SeqCst);
    }
    #[cfg(test)]
    pub(crate) fn pause_next_build(&self) -> (Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>) {
        let gate = (
            Arc::new(tokio::sync::Notify::new()),
            Arc::new(tokio::sync::Notify::new()),
        );
        *self
            .shared
            .build_pause
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(gate.clone());
        gate
    }
    #[cfg(test)]
    pub(crate) fn pause_next_admission(
        &self,
    ) -> (Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>) {
        let gate = (
            Arc::new(tokio::sync::Notify::new()),
            Arc::new(tokio::sync::Notify::new()),
        );
        *self
            .shared
            .admission_pause
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(gate.clone());
        gate
    }
    #[cfg(test)]
    pub(crate) fn expire_contexts(&self) {
        for context in self
            .shared
            .contexts
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values_mut()
        {
            Arc::make_mut(context).expires = Instant::now();
        }
    }
    #[cfg(test)]
    pub(crate) fn expire_observations(&self) {
        for context in self
            .shared
            .discoveries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values_mut()
        {
            if let Some(context) = Arc::get_mut(context) {
                context.expires = Instant::now();
            }
        }
    }
    #[cfg(test)]
    pub(crate) fn context_count(&self) -> usize {
        self.shared
            .contexts
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .len()
    }
    pub fn status(&self) -> SearchStatus {
        self.shared
            .status
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
    pub fn retry(&self) -> Result<(), SearchError> {
        self.control
            .commands
            .send(Command::Retry)
            .map_err(|_| SearchError::Unavailable("worker stopped".into()))
    }
    pub fn rebuild(&self) -> Result<(), SearchError> {
        self.control
            .commands
            .send(Command::Rebuild)
            .map_err(|_| SearchError::Unavailable("worker stopped".into()))
    }
    pub async fn shutdown(&self) {
        self.control.stopping.store(true, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        if self.control.commands.send(Command::Stop(tx)).is_ok() {
            let _ = rx.await;
        }
        let mut done = self.control.done.clone();
        let _ = done.wait_for(|done| *done).await;
    }
    pub async fn query_program(&self, program: Program) -> Result<SearchResult, SearchError> {
        let (tx, rx) = oneshot::channel();
        self.control
            .commands
            .send(Command::Query(Box::new(program), None, tx))
            .map_err(|_| SearchError::Unavailable("worker stopped".into()))?;
        rx.await
            .map_err(|_| SearchError::Unavailable("worker stopped".into()))?
    }
    pub fn analyze_program(&self, program: &Program) -> Result<(), SearchError> {
        let publication = self
            .shared
            .publication
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .ok_or_else(|| SearchError::Unavailable(self.status().state))?;
        crate::compiler::program_bound(&publication.index, &self.mapping, program, None)?;
        Ok(())
    }
    /// Explicit typed predicates use the same aligned observation as source programs.
    pub async fn query(&self, request: SearchRequest) -> Result<SearchResult, SearchError> {
        let program = Program {
            source: locus_query::api::Source {
                format: String::new(),
                version: 0,
                text: request.text.clone(),
            },
        };
        let (tx, rx) = oneshot::channel();
        self.control
            .commands
            .send(Command::Query(Box::new(program), Some(request), tx))
            .map_err(|_| SearchError::Unavailable("worker stopped".into()))?;
        rx.await
            .map_err(|_| SearchError::Unavailable("worker stopped".into()))?
    }
    pub async fn reference_choices(
        &self,
        reference: String,
    ) -> Result<Vec<locus_query::api::ReferenceChoice>, SearchError> {
        self.references.choices(reference).await
    }
    pub async fn observation(&self) -> Result<crate::discovery::Observation, SearchError> {
        let (tx, rx) = oneshot::channel();
        self.control
            .commands
            .send(Command::Observe(tx))
            .map_err(|_| SearchError::Unavailable("worker stopped".into()))?;
        rx.await
            .map_err(|_| SearchError::Unavailable("worker stopped".into()))?
    }
    fn discovery(&self, id: &str) -> Result<Arc<crate::discovery::DiscoveryContext>, SearchError> {
        let mut contexts = self
            .shared
            .discoveries
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        contexts.retain(|_, c| c.expires > Instant::now());
        contexts
            .get(id)
            .cloned()
            .ok_or(SearchError::ContextUnavailable)
    }
    pub fn string_page(
        &self,
        request: crate::discovery::StringPageRequest,
    ) -> Result<crate::discovery::StringPage, SearchError> {
        self.discovery(&request.context)?
            .strings(&self.mapping, request)
    }
    pub fn bounds(
        &self,
        request: crate::discovery::BoundsRequest,
    ) -> Result<crate::discovery::Bounds, SearchError> {
        self.discovery(&request.context)?
            .bounds(&self.mapping, &request.field)
    }
    pub fn release_observation(&self, context: &str) {
        self.shared
            .discoveries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(context);
    }
    pub fn release(&self, context: &str) {
        self.shared
            .contexts
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(context);
    }
    pub(crate) fn context(&self, id: &str) -> Result<Arc<QueryContext>, SearchError> {
        let mut contexts = self
            .shared
            .contexts
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        contexts.retain(|_, c| c.expires > Instant::now());
        contexts
            .get(id)
            .cloned()
            .ok_or(SearchError::ContextUnavailable)
    }
}
