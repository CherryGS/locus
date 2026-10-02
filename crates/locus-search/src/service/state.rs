use super::record::{Publication, QueryContext, SearchRequest, SearchResult, SearchStatus};
use crate::error::SearchError;
use locus_query::api::Program;
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex, RwLock, Weak,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::sync::{mpsc, oneshot};

pub(super) struct Shared {
    #[cfg(test)]
    pub(super) fault: std::sync::atomic::AtomicU8,
    #[cfg(test)]
    pub(super) build_pause: Mutex<Option<(Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>)>>,
    #[cfg(test)]
    pub(super) admission_pause: Mutex<Option<(Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>)>>,
    pub(super) generations: Mutex<HashMap<String, Weak<()>>>,
    pub(super) publication: RwLock<Option<Publication>>,
    pub(super) status: RwLock<SearchStatus>,
    pub(super) contexts: Mutex<HashMap<String, Arc<QueryContext>>>,
    pub(super) discoveries: Mutex<HashMap<String, Arc<crate::discovery::DiscoveryContext>>>,
}
pub(super) struct Control {
    pub(super) commands: mpsc::UnboundedSender<Command>,
    pub(super) stopping: Arc<AtomicBool>,
    pub(super) done: tokio::sync::watch::Receiver<bool>,
}
impl Drop for Control {
    fn drop(&mut self) {
        self.stopping.store(true, Ordering::SeqCst);
    }
}
pub(super) enum Command {
    Observe(oneshot::Sender<Result<crate::discovery::Observation, SearchError>>),
    Retry,
    Rebuild,
    Stop(oneshot::Sender<()>),
    Query(
        Box<Program>,
        Option<SearchRequest>,
        oneshot::Sender<Result<SearchResult, SearchError>>,
    ),
}
