use crate::preferences::service::PreferenceService;
use anyhow::Context;
use locus_core::api::Kernel;
use locus_file::api::{FileOwner, FileService};
use locus_media::api::{ImageOwner, MediaService, VideoOwner};
use locus_store::api::TaskDatabase;
use locus_task::api::TaskQueue;
use locus_twitter::api::{TwitterOwner, TwitterService};
use std::{path::Path, sync::Arc};

#[derive(Clone)]
pub(crate) struct Domain {
    pub database: TaskDatabase,
    pub kernel: Kernel,
    pub files: FileService,
    pub media: MediaService,
    pub twitter: TwitterService,
    pub preferences: PreferenceService,
    pub media_settings: crate::api::settings::dto::MediaSettingsRuntime,
}
impl Domain {
    pub async fn open(queue: &TaskQueue, library: &Library) -> anyhow::Result<Self> {
        let files = library.files.clone();
        let database = library.database.clone();
        let mut kernel = Kernel::new();
        kernel.register(Arc::new(FileOwner))?;
        kernel.register(Arc::new(ImageOwner))?;
        kernel.register(Arc::new(VideoOwner))?;
        kernel.register(Arc::new(TwitterOwner))?;
        let (config, media_settings) =
            super::settings_setup::prepare(queue, &database, &library.settings).await?;
        let media = MediaService::new(files.root(), config)?;
        let preferences = PreferenceService::new(kernel.clone());
        let domain = Self {
            database,
            kernel,
            files,
            media,
            twitter: TwitterService::new(),
            preferences,
            media_settings,
        };
        let init = domain.clone();
        queue
            .submit("Initialize File library", move |task| async move {
                let mut session = init.database.session(&task).await?;
                init.kernel.initialize(&mut session).await?;
                init.files.initialize(&mut session).await?;
                init.media.initialize(&mut session).await?;
                init.twitter.initialize(&mut session).await?;
                init.preferences.initialize(&mut session).await?;
                Ok::<_, anyhow::Error>(())
            })?
            .result()
            .await??;
        Ok(domain)
    }
}

/// Minimal library capability remains usable when required business construction fails.
#[derive(Clone)]
pub(crate) struct Library {
    pub database: TaskDatabase,
    pub files: FileService,
    pub settings: locus_settings::api::SettingsService,
}
impl Library {
    pub async fn open(queue: &TaskQueue, root: &Path) -> anyhow::Result<Self> {
        let files = FileService::new(root)
            .await
            .context("open managed File root")?;
        let database = TaskDatabase::open(queue, files.root().join("metadata.sqlite"))
            .await
            .context("open task-bound database")?;
        let settings =
            locus_settings::api::SettingsService::new(super::settings_setup::registry()?);
        let library = Self {
            database,
            files,
            settings,
        };
        let init = library.clone();
        queue
            .submit("Initialize Settings access", move |task| async move {
                let mut session = init.database.session(&task).await?;
                init.settings.initialize_schema(&mut session).await?;
                Ok::<_, anyhow::Error>(())
            })?
            .result()
            .await??;
        Ok(library)
    }
}
