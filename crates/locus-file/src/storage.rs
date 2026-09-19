use crate::{FileError, FileId, FileRecord, schema};
use locus_store::Session;
use std::{
    fs, io,
    path::{Path, PathBuf},
};

/// An explicit canonical application root. Controlled objects are assumed not to
/// be silently modified. Checks reject existing redirects, but do not defend
/// against hostile concurrent replacement of filesystem ancestors.
#[derive(Debug, Clone)]
pub struct FileStorage {
    pub(crate) root: PathBuf,
}

impl FileStorage {
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
            .transaction(|context| Box::pin(schema::initialize(context)))
            .await
    }
    pub(crate) fn checked_path(&self, id: FileId) -> Result<PathBuf, FileError> {
        let relative = id.relative_path();
        let mut path = self.root.clone();
        // Check the stored canonical root as well, in case it was replaced.
        self.check_existing(id, &path)?;
        for part in relative.split('/') {
            path.push(part);
            self.check_existing(id, &path)?;
        }
        Ok(path)
    }
    fn check_existing(&self, id: FileId, path: &Path) -> Result<(), FileError> {
        match fs::symlink_metadata(path) {
            Ok(metadata) => {
                let resolved = fs::canonicalize(path).map_err(|source| FileError::Access {
                    id,
                    cause: source.into(),
                })?;
                if metadata.file_type().is_symlink() || !resolved.starts_with(&self.root) {
                    return Err(FileError::InvalidLocation {
                        id,
                        path: path.display().to_string(),
                    });
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => (),
            Err(error) => {
                return Err(FileError::Access {
                    id,
                    cause: error.into(),
                });
            }
        }
        Ok(())
    }
    pub(crate) fn record_path(&self, record: &FileRecord) -> Result<PathBuf, FileError> {
        Self::validate_location(record)?;
        self.checked_path(record.id)
    }
}
