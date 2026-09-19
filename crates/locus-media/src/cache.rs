use crate::{
    AttemptFailure, Facts, FailureCode, MediaError, MediaId, MediaKind, MediaStorage,
    image_adapter, video,
};
use locus_core::Kernel;
use locus_file::{FileId, FileStorage};
use locus_store::Session;
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rendition {
    pub edge: u32,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreviewOrigin {
    Hit,
    Generated,
}
#[derive(Debug)]
pub struct Preview {
    pub file: FileId,
    pub kind: MediaKind,
    pub rendition: Rendition,
    pub stream_index: Option<u32>,
    pub path: PathBuf,
    pub origin: PreviewOrigin,
}
fn cache_error(error: impl ToString) -> MediaError {
    MediaError::Cache(error.to_string())
}
impl MediaStorage {
    async fn cache_work<T: Send + 'static>(
        &self,
        operation: impl FnOnce(Self) -> Result<T, MediaError> + Send + 'static,
    ) -> Result<T, MediaError> {
        let permit = self
            .workers
            .clone()
            .acquire_owned()
            .await
            .map_err(cache_error)?;
        let storage = self.clone();
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            operation(storage)
        })
        .await
        .map_err(cache_error)?
    }
    pub(crate) fn check_cache(&self) -> Result<(), MediaError> {
        let root = self
            .cache
            .parent()
            .ok_or_else(|| cache_error("cache parent missing"))?;
        if fs::canonicalize(root).map_err(cache_error)? != root
            || fs::symlink_metadata(root)
                .map_err(cache_error)?
                .file_type()
                .is_symlink()
        {
            return Err(cache_error("application root redirected"));
        }
        match fs::symlink_metadata(&self.cache) {
            Ok(meta) => {
                if !meta.is_dir()
                    || meta.file_type().is_symlink()
                    || fs::canonicalize(&self.cache).map_err(cache_error)? != self.cache
                {
                    return Err(cache_error("cache directory redirected"));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&self.cache).map_err(cache_error)?;
            }
            Err(e) => return Err(cache_error(e)),
        }
        Ok(())
    }
    fn checked_artifact(&self, name: &str) -> Result<PathBuf, MediaError> {
        self.check_cache()?;
        if name.is_empty()
            || !name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.')
        {
            return Err(cache_error("invalid artifact name"));
        }
        let path = self.cache.join(name);
        match fs::symlink_metadata(&path) {
            Ok(meta) => {
                if !meta.is_file()
                    || meta.file_type().is_symlink()
                    || fs::canonicalize(&path).map_err(cache_error)? != path
                {
                    return Err(cache_error("cache artifact redirected or nonregular"));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(cache_error(e)),
        }
        Ok(path)
    }
    fn read_artifact(&self, name: &str, limit: usize) -> Result<Option<Vec<u8>>, MediaError> {
        let path = self.checked_artifact(name)?;
        let file = match fs::File::open(path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(cache_error(e)),
        };
        if file.metadata().map_err(cache_error)?.len() > limit as u64 {
            return Ok(None);
        }
        let mut bytes = Vec::new();
        file.take(limit as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(cache_error)?;
        Ok((bytes.len() <= limit).then_some(bytes))
    }
    fn publish(&self, name: &str, bytes: &[u8]) -> Result<PathBuf, MediaError> {
        let path = self.checked_artifact(name)?;
        let mut temporary = tempfile::Builder::new()
            .prefix("pending-")
            .suffix(".tmp")
            .tempfile_in(&self.cache)
            .map_err(cache_error)?;
        temporary.write_all(bytes).map_err(cache_error)?;
        temporary.flush().map_err(cache_error)?;
        self.checked_artifact(name)?;
        // Atomic replacement of complete cache artifacts; no partial target is exposed.
        temporary.persist(&path).map_err(cache_error)?;
        Ok(path)
    }
    /// Clears only regular flat artifacts in this domain's fixed cache subtree.
    /// Existing redirects/nonregular entries reject cleanup before any removal.
    pub async fn clear_cache(&self) -> Result<usize, MediaError> {
        self.cache_work(move |storage| {
            storage.check_cache()?;
            let mut paths = Vec::new();
            for entry in fs::read_dir(&storage.cache).map_err(cache_error)? {
                let entry = entry.map_err(cache_error)?;
                let name = entry
                    .file_name()
                    .into_string()
                    .map_err(|_| cache_error("invalid cache filename"))?;
                let path = storage.checked_artifact(&name)?;
                if name.starts_with("pending-") || name.starts_with("media-") {
                    paths.push(path);
                }
            }
            for path in &paths {
                storage.checked_artifact(
                    path.file_name()
                        .and_then(|v| v.to_str())
                        .ok_or_else(|| cache_error("filename"))?,
                )?;
                fs::remove_file(path).map_err(cache_error)?;
            }
            Ok(paths.len())
        })
        .await
    }
    pub async fn preview(
        &self,
        kernel: &Kernel,
        files: &FileStorage,
        session: &mut Session,
        id: impl Into<MediaId>,
        rendition: Rendition,
    ) -> Result<Preview, MediaError> {
        if rendition.edge == 0
            || rendition.edge > 2048
            || rendition.edge > self.config.max_dimension
        {
            return Err(MediaError::Configuration(
                "rendition edge must be 1..=2048 and within dimension budget".into(),
            ));
        }
        let id = id.into();
        let kernel = kernel.clone();
        let (record, observed) = session
            .transaction(move |c| {
                Box::pin(async move {
                    let observed = Self::context_in(&kernel, c, id).await?;
                    if let Some(file) = observed.file() {
                        FileStorage::lookup_in(c, file).await?;
                    }
                    Ok::<_, MediaError>((Self::read_in(c, id).await?, observed))
                })
            })
            .await?;
        let file = observed.file().ok_or_else(|| {
            AttemptFailure::new(FailureCode::MissingInput, format!("{observed:?}"))
        })?;
        let hex = file.component().as_uuid().simple().to_string();
        let marker = format!("media-{hex}-video-v1-selection.json");
        let mut stream = None;
        if id.kind() == MediaKind::Video {
            stream = match &record.facts {
                Some(Facts::Video(facts)) if record.basis == Some(file) => Some(facts.stream_index),
                _ => None,
            };
            if stream.is_none() {
                let marker = marker.clone();
                stream = self
                    .cache_work(move |storage| {
                        Ok(storage
                            .read_artifact(&marker, 32)?
                            .and_then(|bytes| serde_json::from_slice::<u32>(&bytes).ok()))
                    })
                    .await?;
            }
        }
        if id.kind() == MediaKind::Image || stream.is_some() {
            let name = name(file, id.kind(), rendition, stream);
            let hit = self
                .cache_work(move |storage| {
                    if let Some(bytes) =
                        storage.read_artifact(&name, storage.config.max_output_bytes)?
                        && image_adapter::validate_png(&bytes, rendition.edge, &storage.config)
                            .is_ok()
                    {
                        return Ok(Some(storage.checked_artifact(&name)?));
                    }
                    Ok(None)
                })
                .await?;
            if let Some(path) = hit {
                return Ok(Preview {
                    file,
                    kind: id.kind(),
                    rendition,
                    stream_index: stream,
                    path,
                    origin: PreviewOrigin::Hit,
                });
            }
        }
        let bytes = match id.kind() {
            MediaKind::Image => {
                image_adapter::thumbnail(
                    self,
                    files.local_path(session, file).await?,
                    rendition.edge,
                )
                .await?
            }
            MediaKind::Video => {
                // Selection is re-established on misses, never borrowed from stale facts.
                let facts = video::inspect(self, files.local_path(session, file).await?).await?;
                stream = Some(facts.stream_index);
                video::cover(
                    self,
                    files.local_path(session, file).await?,
                    &facts,
                    rendition.edge,
                )
                .await?
            }
        };
        let path = self
            .cache_work(move |storage| {
                let path = storage.publish(&name(file, id.kind(), rendition, stream), &bytes)?;
                if let Some(index) = stream {
                    storage.publish(&marker, index.to_string().as_bytes())?;
                }
                Ok(path)
            })
            .await?;
        Ok(Preview {
            file,
            kind: id.kind(),
            rendition,
            stream_index: stream,
            path,
            origin: PreviewOrigin::Generated,
        })
    }
}
fn name(file: FileId, kind: MediaKind, rendition: Rendition, stream: Option<u32>) -> String {
    let hex = file.component().as_uuid().simple().to_string();
    match kind {
        MediaKind::Image => format!("media-{hex}-image-v1-{}.png", rendition.edge),
        MediaKind::Video => format!(
            "media-{hex}-video-v1-first-raster-{}-{}.png",
            stream.map_or_else(|| "none".into(), |v| v.to_string()),
            rendition.edge
        ),
    }
}
