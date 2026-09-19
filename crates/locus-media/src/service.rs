use crate::{config::MediaConfig, error::MediaError, persistence};
use locus_store::api::Session;
use std::{path::PathBuf, sync::Arc};
use tokio::sync::Semaphore;

#[derive(Clone)]
pub struct MediaService {
    pub(crate) cache: PathBuf,
    pub(crate) config: Arc<MediaConfig>,
    pub(crate) workers: Arc<Semaphore>,
}
impl MediaService {
    /// The supplied root is the application's canonical data root. Only its
    /// `media-cache-v1` child is owned/cleared by this domain.
    pub fn new(root: impl AsRef<std::path::Path>, config: MediaConfig) -> Result<Self, MediaError> {
        if config.max_parallel == 0
            || config.max_parallel > Semaphore::MAX_PERMITS
            || config.max_output_bytes == 0
            || config.max_output_bytes == usize::MAX
            || config.max_dimension == 0
            || config.max_pixels == 0
            || config.max_allocation == 0
            || config.max_input_bytes == 0
            || config.process_timeout.is_zero()
        {
            return Err(MediaError::Configuration("budgets must be positive".into()));
        }
        let root = std::fs::canonicalize(root).map_err(|e| MediaError::Cache(e.to_string()))?;
        let storage = Self {
            cache: root.join("media-cache-v1"),
            workers: Arc::new(Semaphore::new(config.max_parallel)),
            config: Arc::new(config),
        };
        storage.check_cache()?;
        Ok(storage)
    }
    pub async fn initialize(&self, session: &mut Session) -> Result<(), MediaError> {
        session
            .transaction(|context| Box::pin(persistence::initialize(context)))
            .await
    }
    pub fn cache_root(&self) -> &std::path::Path {
        &self.cache
    }
}
