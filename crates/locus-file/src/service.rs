use crate::{error::FileError, persistence};
use locus_store::api::Session;
use std::{
    fs,
    path::{Path, PathBuf},
};

/// An explicit canonical application root. Controlled objects are assumed not to
/// be silently modified. Checks reject existing redirects, but do not defend
/// against hostile concurrent replacement of filesystem ancestors.
#[derive(Debug, Clone)]
pub struct FileService {
    pub(crate) root: PathBuf,
}

impl FileService {
    pub async fn new(root: impl AsRef<Path>) -> Result<Self, FileError> {
        let root = root.as_ref().to_path_buf();
        tokio::task::spawn_blocking(move || {
            fs::create_dir_all(&root).map_err(|source| FileError::Io {
                path: root.clone(),
                source,
            })?;
            let root =
                fs::canonicalize(&root).map_err(|source| FileError::Io { path: root, source })?;
            Ok(Self { root })
        })
        .await
        .map_err(|error| FileError::Worker(error.to_string()))?
    }
    pub fn root(&self) -> &Path {
        &self.root
    }
    pub async fn initialize(&self, session: &mut Session) -> Result<(), FileError> {
        session
            .transaction(|context| Box::pin(persistence::initialize(context)))
            .await
    }
}
