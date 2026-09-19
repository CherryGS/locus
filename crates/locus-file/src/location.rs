use crate::{error::FileError, identity::FileId, record::FileRecord, service::FileService};
use std::{
    fs, io,
    path::{Path, PathBuf},
};

impl FileId {
    pub(crate) fn relative_path(self) -> String {
        let hex = self.component().as_uuid().simple().to_string();
        format!("object/{}/{hex}", &hex[28..])
    }
}

impl FileService {
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
    pub(crate) fn validate_location(record: &FileRecord) -> Result<(), FileError> {
        if record.relative_path != record.id.relative_path() {
            return Err(FileError::InvalidLocation {
                id: record.id,
                path: record.relative_path.clone(),
            });
        }
        Ok(())
    }
}
