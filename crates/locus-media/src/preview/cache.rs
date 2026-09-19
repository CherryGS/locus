use crate::{error::MediaError, service::MediaService};
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
};

fn cache_error(error: impl ToString) -> MediaError {
    MediaError::Cache(error.to_string())
}
impl MediaService {
    pub(super) async fn cache_task<T: Send + 'static>(
        &self,
        task: Option<&locus_task::api::TaskContext>,
        operation: impl FnOnce(Self) -> Result<T, MediaError> + Send + 'static,
    ) -> Result<T, MediaError> {
        self.task_work(task, "Media preview cache", move |storage| async move {
            storage.cache_work(operation).await
        })
        .await
    }

    pub(super) async fn cache_work<T: Send + 'static>(
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
        self.blocking(move || {
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
    pub(super) fn checked_artifact(&self, name: &str) -> Result<PathBuf, MediaError> {
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
    pub(super) fn read_artifact(
        &self,
        name: &str,
        limit: usize,
    ) -> Result<Option<Vec<u8>>, MediaError> {
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
    pub(super) fn publish(&self, name: &str, bytes: &[u8]) -> Result<PathBuf, MediaError> {
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
}
