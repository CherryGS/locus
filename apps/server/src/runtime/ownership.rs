use anyhow::Context;
use std::{
    fs::{File, OpenOptions, TryLockError},
    path::{Path, PathBuf},
};

#[derive(Debug, thiserror::Error)]
#[error("This library is already in use by another Locus backend")]
pub(super) struct LibraryInUse;

/// The sidecar is permanent; only the OS lock on this owned handle denotes a
/// live runtime. Standard File opens are non-inheritable by tool subprocesses.
pub(super) struct LibraryOwnership {
    root: PathBuf,
    _file: File,
}
impl LibraryOwnership {
    pub fn acquire(root: &Path, require_existing: bool) -> anyhow::Result<Self> {
        // A restart locator is not permission to create a replacement library.
        if require_existing && !root.join("metadata.sqlite").is_file() {
            anyhow::bail!("Intended library database is missing; refusing to create a replacement");
        }
        std::fs::create_dir_all(root).context("Open the intended library directory")?;
        let root = std::fs::canonicalize(root).context("Resolve the intended library directory")?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(root.join(".locus-runtime.lock"))
            .context("Open the library runtime ownership file")?;
        match file.try_lock() {
            Ok(()) => Ok(Self { root, _file: file }),
            Err(TryLockError::WouldBlock) => Err(LibraryInUse.into()),
            Err(TryLockError::Error(error)) => {
                Err(error).context("Establish exclusive library use")
            }
        }
    }
    pub fn root(&self) -> &Path {
        &self.root
    }
}
