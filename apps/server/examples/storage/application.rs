use anyhow::Context;
use locus_core::api::Kernel;
use locus_file::api::{FileOwner, FileService};
use locus_media::api::{ImageOwner, MediaConfig, MediaService, VideoOwner};
use locus_store::api::Session;
use locus_twitter::api::{TwitterOwner, TwitterService};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

pub struct ApplicationStorage {
    pub session: Session,
    pub kernel: Kernel,
    pub files: FileService,
    pub media: MediaService,
    pub twitter: TwitterService,
}
impl ApplicationStorage {
    pub async fn open(root: impl AsRef<Path>) -> anyhow::Result<Self> {
        let files = FileService::new(root)
            .await
            .context("open managed File root")?;
        let mut session = Session::open(files.root().join("metadata.sqlite"))
            .await
            .context("open metadata.sqlite")?;
        let mut kernel = Kernel::new();
        let twitter = TwitterService::new();
        let media = MediaService::new(
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
            .register(Arc::new(TwitterOwner))
            .context("register Twitter owner")?;
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
        twitter
            .initialize(&mut session)
            .await
            .context("initialize Twitter schema")?;
        Ok(Self {
            session,
            kernel,
            files,
            media,
            twitter,
        })
    }
}
