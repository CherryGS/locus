use crate::{MediaError, schema};
use locus_store::Session;
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::Semaphore;

/// Work budgets, not a process sandbox or a hard memory/cancellation guarantee.
#[derive(Debug, Clone)]
pub struct MediaConfig {
    pub ffprobe: PathBuf,
    pub ffmpeg: PathBuf,
    pub max_input_bytes: u64,
    pub max_dimension: u32,
    pub max_pixels: u64,
    pub max_allocation: u64,
    pub max_output_bytes: usize,
    pub max_parallel: usize,
    pub process_timeout: Duration,
}
impl Default for MediaConfig {
    fn default() -> Self {
        Self {
            ffprobe: "ffprobe".into(),
            ffmpeg: "ffmpeg".into(),
            max_input_bytes: 512 * 1024 * 1024,
            max_dimension: 32768,
            max_pixels: 40_000_000,
            max_allocation: 320_000_000,
            max_output_bytes: 8 * 1024 * 1024,
            max_parallel: 2,
            process_timeout: Duration::from_secs(30),
        }
    }
}
#[derive(Clone)]
pub struct MediaStorage {
    pub(crate) cache: PathBuf,
    pub(crate) config: Arc<MediaConfig>,
    pub(crate) workers: Arc<Semaphore>,
}
impl MediaStorage {
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
            .transaction(|context| Box::pin(schema::initialize(context)))
            .await
    }
    pub fn cache_root(&self) -> &std::path::Path {
        &self.cache
    }
}
