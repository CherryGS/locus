use crate::{error::SearchError, journal, projection::Providers, schema::Mapping};
use locus_core::api::{EntityId, Kernel};
use locus_query::api::{Catalogue, Condition, Program, Provider};
use locus_store::api::{Context, TaskDatabase, TransactionFuture};
use locus_task::api::TaskQueue;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, RwLock, Weak,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tantivy::{Index, IndexReader, IndexWriter, ReloadPolicy, Searcher, TantivyDocument, Term};
use tokio::sync::{mpsc, oneshot};

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
pub struct SearchRequest {
    #[serde(default)]
    pub text: String,
    pub filter: Option<Condition>,
}
#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
pub struct SearchStatus {
    pub state: String,
    pub usable: bool,
    pub generation: Option<String>,
    pub covered_sequence: String,
    pub journal_head: String,
    pub completed: String,
    pub total: Option<String>,
    pub failure: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Checkpoint {
    pub identity: String,
    pub fingerprint: String,
    pub generation: String,
    pub covered: i64,
}
#[derive(Clone)]
pub(crate) struct Publication {
    _lease: Arc<()>,
    pub index: Index,
    pub reader: IndexReader,
    pub checkpoint: Checkpoint,
}
#[derive(Clone)]
pub(crate) struct QueryContext {
    pub searcher: Searcher,
    pub publication: Publication,
    pub request: SearchRequest,
    pub program: Option<Program>,
    pub expires: Instant,
}
struct Shared {
    #[cfg(test)]
    fault: std::sync::atomic::AtomicU8,
    #[cfg(test)]
    build_pause: Mutex<Option<(Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>)>>,
    #[cfg(test)]
    admission_pause: Mutex<Option<(Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>)>>,
    generations: Mutex<HashMap<String, Weak<()>>>,
    publication: RwLock<Option<Publication>>,
    status: RwLock<SearchStatus>,
    contexts: Mutex<HashMap<String, Arc<QueryContext>>>,
}
#[derive(Clone)]
pub struct SearchService {
    pub(crate) mapping: Arc<Mapping>,
    pub(crate) catalogue: Catalogue,
    shared: Arc<Shared>,
    control: Arc<Control>,
}
struct Control {
    commands: mpsc::UnboundedSender<Command>,
    stopping: Arc<AtomicBool>,
    done: tokio::sync::watch::Receiver<bool>,
}
impl Drop for Control {
    fn drop(&mut self) {
        self.stopping.store(true, Ordering::SeqCst);
    }
}
enum Command {
    Retry,
    Rebuild,
    Stop(oneshot::Sender<()>),
    Query(
        Box<Program>,
        Option<SearchRequest>,
        oneshot::Sender<Result<SearchResult, SearchError>>,
    ),
}
pub struct SearchResult {
    pub bytes: Vec<u8>,
    pub context: String,
    pub generation: String,
    pub covered_sequence: String,
    pub expires_after_seconds: u64,
}
/// A writer's owned threads are joined even when its surrounding future is dropped.
struct Writer(Option<IndexWriter>);
impl Writer {
    fn get(&mut self) -> Result<&mut IndexWriter, SearchError> {
        self.0
            .as_mut()
            .ok_or_else(|| SearchError::Invalid("closed writer".into()))
    }
}
impl Drop for Writer {
    fn drop(&mut self) {
        if let Some(writer) = self.0.take() {
            let _ = writer.wait_merging_threads();
        }
    }
}
#[derive(Clone)]
struct Worker {
    stopping: Arc<AtomicBool>,
    done: tokio::sync::watch::Sender<bool>,
    shared: Arc<Shared>,
    mapping: Arc<Mapping>,
    providers: Providers,
    root: PathBuf,
    queue: TaskQueue,
    database: TaskDatabase,
    kernel: Kernel,
    _lifetime: Arc<dyn Send + Sync>,
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
            }),
            contexts: Mutex::new(HashMap::new()),
        });
        let (commands, receiver) = mpsc::unbounded_channel();
        let stopping = Arc::new(AtomicBool::new(false));
        let (done, done_rx) = tokio::sync::watch::channel(false);
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
        crate::compiler::program(&publication.index, &self.mapping, program)?;
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
impl Worker {
    #[cfg(test)]
    fn fault(&self, phase: u8) -> Result<(), SearchError> {
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
    async fn db<T, F>(&self, f: F) -> Result<T, SearchError>
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
    fn check_stop(&self) -> Result<(), SearchError> {
        if self.stopping.load(Ordering::SeqCst) {
            Err(SearchError::Unavailable("worker stopping".into()))
        } else {
            Ok(())
        }
    }
    fn lease(&self, generation: &str) -> Arc<()> {
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
    fn status(&self, change: impl FnOnce(&mut SearchStatus)) {
        change(
            &mut self
                .shared
                .status
                .write()
                .unwrap_or_else(|e| e.into_inner()),
        );
    }
    async fn run(self, mut commands: mpsc::UnboundedReceiver<Command>) {
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
            command=commands.recv()=>match command{Some(Command::Retry)=>active=true,Some(Command::Rebuild)=>{active=true;rebuild=true;},Some(Command::Query(program,typed,reply))=>{let result=self.admit(*program,typed).await;let _=reply.send(result);},Some(Command::Stop(reply))=>{let _=reply.send(());break},None=>break},
            _=tokio::time::sleep(Duration::from_millis(250))=>{},
            }
        }
        self.done.send_replace(true);
    }
    async fn admit(
        &self,
        program: Program,
        typed: Option<SearchRequest>,
    ) -> Result<SearchResult, SearchError> {
        let worker = self.clone();
        self.queue
            .submit("Align Filter query", move |task| async move {
                let protected = worker.database.protect(&task).await?;
                #[cfg(test)]
                {
                    let pause = worker
                        .shared
                        .admission_pause
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .take();
                    if let Some((entered, release)) = pause {
                        entered.notify_one();
                        release.notified().await;
                    }
                }
                let mut session = protected.session().await?;
                let mut publication = worker
                    .shared
                    .publication
                    .read()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone()
                    .ok_or_else(|| SearchError::Unavailable("index is not ready".into()))?;
                loop {
                    let after = publication.checkpoint.covered;
                    let providers = worker.providers.clone();
                    let kernel = worker.kernel.clone();
                    let (covered, projected) = session
                        .transaction(move |c| {
                            Box::pin(async move {
                                let (covered, ids) = journal::pending(c, after).await?;
                                Ok::<_, SearchError>((
                                    covered,
                                    providers.project(c, &kernel, &ids).await?,
                                ))
                            })
                        })
                        .await?;
                    if covered == after {
                        break;
                    }
                    let mut writer = worker.writer(&publication.index)?;
                    for (id, value) in projected {
                        writer
                            .get()?
                            .delete_term(Term::from_field_text(worker.mapping.id, &id.to_string()));
                        if let Some(value) = value {
                            writer
                                .get()?
                                .add_document(worker.mapping.document(id, &value)?)?;
                        }
                    }
                    publication.checkpoint.covered = covered;
                    worker.commit(&mut writer, &publication.checkpoint)?;
                    drop(writer);
                    publication.reader = publication
                        .index
                        .reader_builder()
                        .reload_policy(ReloadPolicy::Manual)
                        .try_into()?;
                    session
                        .transaction(move |c| Box::pin(journal::acknowledge(c, covered)))
                        .await?;
                }
                let boundary = session
                    .transaction(|c| Box::pin(journal::boundary(c)))
                    .await?;
                worker.status(|s| {
                    s.journal_head = boundary
                        .head
                        .max(s.journal_head.parse::<i64>().unwrap_or(0))
                        .to_string()
                });
                worker.publish(publication.clone());
                let searcher = publication.reader.searcher();
                // The aligned Searcher is captured before releasing exclusion.
                drop(session);
                drop(protected);
                let query = if let Some(request) = &typed {
                    crate::compiler::compile(
                        &publication.index,
                        &worker.mapping,
                        &worker.providers.catalogue,
                        &request.text,
                        request.filter.as_ref(),
                    )?
                } else {
                    crate::compiler::program(&publication.index, &worker.mapping, &program)?
                };
                let mut hits =
                    searcher.search(&*query, &crate::collector::Complete { scoring: true })?;
                hits.sort_unstable_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
                let mut bytes = Vec::with_capacity(hits.len() * 16);
                for (_, id) in hits {
                    EntityId::from_bytes(&id).map_err(|e| SearchError::Invalid(e.to_string()))?;
                    bytes.extend_from_slice(&id);
                }
                let context = uuid::Uuid::now_v7().to_string();
                let result = SearchResult {
                    bytes,
                    context: context.clone(),
                    generation: publication.checkpoint.generation.clone(),
                    covered_sequence: publication.checkpoint.covered.to_string(),
                    expires_after_seconds: 600,
                };
                let mut contexts = worker
                    .shared
                    .contexts
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                contexts.retain(|_, c| c.expires > Instant::now());
                contexts.insert(
                    context,
                    Arc::new(QueryContext {
                        searcher,
                        publication,
                        program: if typed.is_none() { Some(program) } else { None },
                        request: typed.unwrap_or(SearchRequest {
                            text: String::new(),
                            filter: None,
                        }),
                        expires: Instant::now() + Duration::from_secs(600),
                    }),
                );
                Ok(result)
            })?
            .result()
            .await?
    }
    async fn maintain(&self, rebuild: bool) -> Result<(), SearchError> {
        let boundary = self.db(|c| Box::pin(journal::boundary(c))).await?;
        self.status(|s| s.journal_head = boundary.head.to_string());
        let mut publication = self
            .shared
            .publication
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        if publication.is_none() && !rebuild {
            publication = self.reopen(&boundary.identity, boundary.head)?;
            if let Some(baseline) = &publication {
                self.publish(baseline.clone());
            }
        }
        let publication = if rebuild || publication.is_none() {
            self.build(&boundary.identity).await?
        } else {
            publication.ok_or_else(|| SearchError::Invalid("publication".into()))?
        };
        let publication = self.catch_up(publication).await?;
        self.publish(publication);
        Ok(())
    }
    fn reopen(&self, identity: &str, head: i64) -> Result<Option<Publication>, SearchError> {
        let pointer = self.root.join("current");
        if !pointer.exists() {
            return Ok(None);
        }
        let generation = std::fs::read_to_string(pointer)?;
        if uuid::Uuid::parse_str(&generation).is_err() {
            return Ok(None);
        }
        let index = match Index::open_in_dir(self.root.join(&generation)) {
            Ok(index) => index,
            Err(_) => return Ok(None),
        };
        self.mapping.configure(&index);
        let metas = match index.load_metas() {
            Ok(m) => m,
            Err(_) => return Ok(None),
        };
        let checkpoint: Checkpoint = match metas.payload.as_deref().map(serde_json::from_str) {
            Some(Ok(c)) => c,
            _ => return Ok(None),
        };
        if checkpoint.identity != identity
            || checkpoint.fingerprint != self.mapping.fingerprint
            || checkpoint.generation != generation
            || checkpoint.covered > head
            || checkpoint.covered < 0
            || index.schema() != self.mapping.schema
        {
            return Ok(None);
        }
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;
        Ok(Some(Publication {
            _lease: self.lease(&checkpoint.generation),
            index,
            reader,
            checkpoint,
        }))
    }
    fn writer(&self, index: &Index) -> Result<Writer, SearchError> {
        Ok(Writer(Some(index.writer_with_num_threads(1, 50_000_000)?)))
    }
    fn commit(&self, writer: &mut Writer, checkpoint: &Checkpoint) -> Result<(), SearchError> {
        #[cfg(test)]
        self.fault(1)?;
        let mut commit = writer.get()?.prepare_commit()?;
        commit.set_payload(&serde_json::to_string(checkpoint)?);
        commit.commit()?;
        #[cfg(test)]
        self.fault(2)?;
        Ok(())
    }
    async fn build(&self, identity: &str) -> Result<Publication, SearchError> {
        self.status(|s| {
            s.state = if s.usable { "rebuilding" } else { "preparing" }.into();
            s.failure = None;
            s.completed = "0".into();
        });
        let kernel = self.kernel.clone();
        let (ids, boundary) = self
            .db(move |c| {
                Box::pin(async move {
                    let boundary = journal::boundary(c).await?;
                    let ids = kernel.entity_ids_in(c).await?;
                    Ok((ids, boundary))
                })
            })
            .await?;
        if boundary.identity != identity {
            return Err(SearchError::Invalid("library identity changed".into()));
        }
        self.status(|s| s.total = Some(ids.len().to_string()));
        #[cfg(test)]
        {
            let pause = self
                .shared
                .build_pause
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .take();
            if let Some((entered, release)) = pause {
                entered.notify_one();
                release.notified().await;
            }
        }
        self.check_stop()?;
        let generation = uuid::Uuid::now_v7().to_string();
        let path = self.root.join(&generation);
        std::fs::create_dir_all(&path)?;
        let index = Index::create_in_dir(&path, self.mapping.schema.clone())?;
        self.mapping.configure(&index);
        let mut writer = self.writer(&index)?;
        let mut completed = 0;
        for chunk in ids.as_bytes().chunks(16 * 256) {
            self.check_stop()?;
            let entities = chunk
                .chunks_exact(16)
                .map(|b| EntityId::from_bytes(b).map_err(|e| SearchError::Invalid(e.to_string())))
                .collect::<Result<Vec<_>, _>>()?;
            let providers = self.providers.clone();
            let kernel = self.kernel.clone();
            let projected = self
                .db(move |c| {
                    Box::pin(async move { providers.project(c, &kernel, &entities).await })
                })
                .await?;
            let documents = projected
                .into_iter()
                .filter_map(|(id, p)| p.map(|p| self.mapping.document(id, &p)))
                .collect::<Result<Vec<_>, _>>()?;
            for document in documents {
                writer.get()?.add_document(document)?;
            }
            completed += chunk.len() / 16;
            self.status(|s| s.completed = completed.to_string());
        }
        let checkpoint = Checkpoint {
            identity: identity.into(),
            fingerprint: self.mapping.fingerprint.clone(),
            generation,
            covered: boundary.head,
        };
        self.commit(&mut writer, &checkpoint)?;
        drop(writer);
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;
        let publication = self
            .catch_up(Publication {
                _lease: self.lease(&checkpoint.generation),
                index,
                reader,
                checkpoint,
            })
            .await?;
        // A pointer is only written after a complete durable generation. If interrupted
        // between removal and rename, startup rebuilds; an acknowledgement never certifies it.
        let next = self.root.join("current.next");
        std::fs::write(&next, &publication.checkpoint.generation)?;
        let pointer = self.root.join("current");
        if pointer.exists() {
            std::fs::remove_file(&pointer)?;
        }
        std::fs::rename(next, pointer)?;
        let covered = publication.checkpoint.covered;
        self.db(move |c| Box::pin(journal::acknowledge(c, covered)))
            .await?;
        Ok(publication)
    }
    async fn catch_up(&self, mut publication: Publication) -> Result<Publication, SearchError> {
        loop {
            self.check_stop()?;
            let after = publication.checkpoint.covered;
            let providers = self.providers.clone();
            let kernel = self.kernel.clone();
            let (covered, projected, head) = self
                .db(move |c| {
                    Box::pin(async move {
                        let (covered, ids) = journal::pending(c, after).await?;
                        let values = providers.project(c, &kernel, &ids).await?;
                        Ok((covered, values, journal::boundary(c).await?.head))
                    })
                })
                .await?;
            self.status(|s| {
                s.journal_head = head.to_string();
                if covered > after && s.usable {
                    s.state = "pending".into();
                }
            });
            if covered == after {
                break;
            }
            let documents = projected
                .into_iter()
                .map(|(id, p)| Ok((id, p.map(|p| self.mapping.document(id, &p)).transpose()?)))
                .collect::<Result<Vec<(EntityId, Option<TantivyDocument>)>, SearchError>>()?;
            let mut writer = self.writer(&publication.index)?;
            for (id, document) in documents {
                writer
                    .get()?
                    .delete_term(Term::from_field_text(self.mapping.id, &id.to_string()));
                if let Some(document) = document {
                    writer.get()?.add_document(document)?;
                }
            }
            let mut checkpoint = publication.checkpoint.clone();
            checkpoint.covered = covered;
            self.commit(&mut writer, &checkpoint)?;
            drop(writer);
            // Reader publication is separate from durable commit and SQLite acknowledgement.
            // A failed reload leaves shared publication untouched. Retry reopens durable state.
            #[cfg(test)]
            self.fault(3)?;
            let reader = publication
                .index
                .reader_builder()
                .reload_policy(ReloadPolicy::Manual)
                .try_into()?;
            publication.reader = reader;
            publication.checkpoint = checkpoint;
            #[cfg(test)]
            self.fault(4)?;
            self.db(move |c| Box::pin(journal::acknowledge(c, covered)))
                .await?;
            if covered >= head {
                break;
            }
        }
        Ok(publication)
    }
    fn publish(&self, publication: Publication) {
        let checkpoint = publication.checkpoint.clone();
        *self
            .shared
            .publication
            .write()
            .unwrap_or_else(|e| e.into_inner()) = Some(publication);
        self.status(|s| {
            s.state = "ready".into();
            s.usable = true;
            s.generation = Some(checkpoint.generation);
            s.covered_sequence = checkpoint.covered.to_string();
            s.failure = None;
            s.total = None;
        });
    }
}
