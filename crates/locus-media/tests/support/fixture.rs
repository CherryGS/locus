#![allow(dead_code)]
use diesel::{QueryableByName, sql_query, sql_types::BigInt};
use diesel_async::{RunQueryDsl, SimpleAsyncConnection};
use locus_core::api::{EntityId, Kernel, Membership};
use locus_file::api::{FILE_KIND, FileId, FileOwner, FileService};
use locus_media::api::{
    ImageOwner, MediaConfig, MediaError, MediaId, MediaKind, MediaService, VideoOwner,
};
use locus_store::api::Session;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
pub struct Fixture {
    pub session: Session,
    pub kernel: Kernel,
    pub files: FileService,
    pub media: MediaService,
    pub database: PathBuf,
    pub directory: tempfile::TempDir,
}
impl Fixture {
    pub async fn new() -> Self {
        Self::configured(MediaConfig::default()).await
    }
    pub async fn configured(config: MediaConfig) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let files = FileService::new(directory.path().join("library"))
            .await
            .unwrap();
        let database = files.root().join("metadata.sqlite");
        let mut session = Session::open(&database).await.unwrap();
        let mut kernel = Kernel::new();
        kernel.register(Arc::new(FileOwner)).unwrap();
        kernel.register(Arc::new(ImageOwner)).unwrap();
        kernel.register(Arc::new(VideoOwner)).unwrap();
        locus_migration::api::migrate(&mut session).await.unwrap();
        let media = MediaService::new(files.root(), config).unwrap();
        locus_migration::api::migrate(&mut session).await.unwrap();
        Self {
            session,
            kernel,
            files,
            media,
            database,
            directory,
        }
    }
    pub async fn attach(&mut self, entity: EntityId, id: MediaId) -> Membership {
        let membership = Membership {
            entity,
            kind: id.kind().kind(),
            component: id.component(),
        };
        self.kernel
            .attach(&mut self.session, membership)
            .await
            .unwrap();
        membership
    }
    pub async fn admit(&mut self, source: &Path, entity: EntityId) -> FileId {
        let file = self
            .files
            .admit(&self.kernel, &mut self.session, source)
            .await
            .unwrap();
        self.kernel
            .attach(
                &mut self.session,
                Membership {
                    entity,
                    kind: FILE_KIND,
                    component: file.id.component(),
                },
            )
            .await
            .unwrap();
        file.id
    }
    pub async fn component(&mut self, kind: MediaKind) -> (EntityId, MediaId) {
        let entity = self.kernel.create_entity(&mut self.session).await.unwrap();
        let id = self
            .media
            .create(&self.kernel, &mut self.session, kind)
            .await
            .unwrap();
        self.attach(entity, id).await;
        (entity, id)
    }
    pub fn png(&self, name: &str, width: u32, height: u32) -> PathBuf {
        let path = self.directory.path().join(name);
        image::RgbaImage::from_pixel(width, height, image::Rgba([100, 20, 230, 255]))
            .save_with_format(&path, image::ImageFormat::Png)
            .unwrap();
        path
    }
}
#[derive(QueryableByName)]
struct Count {
    #[diesel(sql_type = BigInt)]
    count: i64,
}
pub async fn count(session: &mut Session, query: &'static str) -> i64 {
    session
        .transaction::<_, MediaError, _>(move |c| {
            Box::pin(async move {
                Ok(sql_query(query)
                    .get_result::<Count>(c.connection())
                    .await?
                    .count)
            })
        })
        .await
        .unwrap()
}
pub async fn execute(session: &mut Session, query: String) {
    session
        .transaction::<_, MediaError, _>(move |c| {
            Box::pin(async move {
                c.connection().batch_execute(&query).await?;
                Ok(())
            })
        })
        .await
        .unwrap();
}
