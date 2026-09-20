use anyhow::Context;
use locus_core::api::Kernel;
use locus_file::api::{FileOwner, FileService};
use locus_store::api::TaskDatabase;
use locus_task::api::TaskQueue;
use std::{path::Path, sync::Arc};

#[derive(Clone)]
pub(crate) struct Domain {
    pub database: TaskDatabase,
    pub kernel: Kernel,
    pub files: FileService,
}
impl Domain {
    pub async fn open(queue: &TaskQueue, root: &Path) -> anyhow::Result<Self> {
        let files = FileService::new(root)
            .await
            .context("open managed File root")?;
        let database = TaskDatabase::open(queue, files.root().join("metadata.sqlite"))
            .await
            .context("open task-bound database")?;
        let mut kernel = Kernel::new();
        kernel.register(Arc::new(FileOwner))?;
        let domain = Self {
            database,
            kernel,
            files,
        };
        let init = domain.clone();
        queue
            .submit("Initialize File library", move |task| async move {
                let mut session = init.database.session(&task).await?;
                init.kernel.initialize(&mut session).await?;
                init.files.initialize(&mut session).await?;
                Ok::<_, anyhow::Error>(())
            })?
            .result()
            .await??;
        Ok(domain)
    }
}
