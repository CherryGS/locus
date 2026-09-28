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
    pub model: locus_model::api::ModelService,
    pub twitter: TwitterService,
    pub bilibili: locus_bilibili::api::BilibiliService,
    pub civitai: locus_civitai::api::CivitaiService,
    pub preferences: PreferenceService,
    pub media_settings: crate::api::settings::dto::MediaSettingsRuntime,
    pub external_settings: crate::api::settings::dto::SavedSettings,
}
impl Domain {
    pub async fn open(queue: &TaskQueue, library: &Library) -> anyhow::Result<Self> {
        let files = library.files.clone();
        let database = library.database.clone();
        let mut kernel = Kernel::new();
        kernel.register(Arc::new(FileOwner))?;
        kernel.register(Arc::new(locus_tag::api::TagSetOwner))?;
        kernel.register(Arc::new(ImageOwner))?;
        kernel.register(Arc::new(VideoOwner))?;
        kernel.register(Arc::new(locus_model::api::ModelOwner))?;
        kernel.register(Arc::new(TwitterOwner))?;
        kernel.register(Arc::new(locus_bilibili::api::BilibiliOwner))?;
        kernel.register(Arc::new(locus_civitai::api::CivitaiOwner))?;
        let (config, media_settings) =
            super::settings_setup::prepare(queue, &database, &library.settings).await?;
        let external_settings =
            super::settings_setup::prepare_external(queue, &database, &library.settings).await?;
        let media = MediaService::new(files.root(), config)?;
        let preferences = PreferenceService::new(kernel.clone());
        let domain = Self {
            database,
            kernel,
            files,
            media,
            model: locus_model::api::ModelService::new(),
            twitter: TwitterService::new(),
            bilibili: locus_bilibili::api::BilibiliService::new(),
            civitai: {
                #[cfg(not(test))]
                {
                    locus_civitai::api::CivitaiService::new()?
                }
                #[cfg(test)]
                {
                    locus_civitai::api::CivitaiService::with_upstream(Arc::new(
                        super::civitai_test_upstream::NoMatch,
                    ))
                }
            },
            preferences,
            media_settings,
            external_settings,
        };
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
    pub async fn open(
        queue: &TaskQueue,
        root: &Path,
        #[cfg(test)] probe: Option<super::ownership_tests::StartupProbe>,
    ) -> anyhow::Result<Self> {
        let database = TaskDatabase::open(queue, root.join("metadata.sqlite"))
            .await
            .context("open task-bound database")?;
        let migration_database = database.clone();
        #[cfg(test)]
        let migration_root = root.to_path_buf();
        queue
            .submit("Migrate library", move |task| async move {
                let mut session = migration_database.session(&task).await?;
                locus_migration::api::migrate(&mut session).await?;
                #[cfg(test)]
                if let Some(probe) = probe {
                    probe.run(&task, &migration_root).await?;
                }
                Ok::<_, anyhow::Error>(())
            })?
            .result()
            .await??;
        let files = FileService::new(root)
            .await
            .context("open managed File root")?;
        let settings =
            locus_settings::api::SettingsService::new(super::settings_setup::registry()?);
        let library = Self {
            database,
            files,
            settings,
        };
        Ok(library)
    }
}
