use anyhow::{Context, anyhow};
use locus_core::Kernel;
use locus_file::{FileOwner, FileStorage};
use locus_media::{ImageOwner, MediaConfig, MediaStorage, VideoOwner};
use locus_store::Session;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

/// Runtime composition owned by the application; libraries never read environment.
pub fn configured_root() -> anyhow::Result<PathBuf> {
    if let Some(root) = std::env::var_os("LOCUS_DATA_DIR") {
        if root.is_empty() {
            return Err(anyhow!("LOCUS_DATA_DIR must not be empty"));
        }
        return Ok(PathBuf::from(root));
    }
    let base = directories::BaseDirs::new().context("resolve local application-data directory")?;
    // BaseDirs adds no application/vendor/data suffix: Windows is LocalAppData/Locus.
    Ok(base.data_local_dir().join("Locus"))
}

pub struct ApplicationStorage {
    pub session: Session,
    pub kernel: Kernel,
    pub files: FileStorage,
    pub media: MediaStorage,
}
impl ApplicationStorage {
    pub async fn open(root: impl AsRef<Path>) -> anyhow::Result<Self> {
        let files = FileStorage::new(root)
            .await
            .context("open managed File root")?;
        let mut session = Session::open(files.root().join("metadata.sqlite"))
            .await
            .context("open metadata.sqlite")?;
        let mut kernel = Kernel::new();
        let media = MediaStorage::new(
            files.root(),
            MediaConfig {
                ffprobe: std::env::var_os("LOCUS_FFPROBE")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| "ffprobe".into()),
                ffmpeg: std::env::var_os("LOCUS_FFMPEG")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| "ffmpeg".into()),
                ..MediaConfig::default()
            },
        )
        .context("configure Media")?;
        kernel
            .register(Arc::new(ImageOwner))
            .context("register Image owner")?;
        kernel
            .register(Arc::new(VideoOwner))
            .context("register Video owner")?;
        kernel
            .register(Arc::new(FileOwner))
            .context("register File owner")?;
        kernel
            .initialize(&mut session)
            .await
            .context("initialize identity kernel")?;
        files
            .initialize(&mut session)
            .await
            .context("initialize File schema")?;
        media
            .initialize(&mut session)
            .await
            .context("initialize Media schema")?;
        Ok(Self {
            session,
            kernel,
            files,
            media,
        })
    }
}

#[cfg(test)]
#[path = "storage/tests.rs"]
mod tests;
