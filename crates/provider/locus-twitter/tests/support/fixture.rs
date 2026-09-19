#![allow(dead_code)]
use diesel::{QueryableByName, sql_query, sql_types::BigInt};
use diesel_async::{RunQueryDsl, SimpleAsyncConnection};
use locus_core::api::{EntityId, Kernel, Membership};
use locus_file::api::{FILE_KIND, FileId, FileOwner, FileService};
use locus_store::api::Session;
use locus_twitter::api::*;
use std::{path::PathBuf, sync::Arc};

pub fn snapshot() -> TwitterSnapshot {
    TwitterSnapshot {
        post_id: Some("123456789".into()),
        ..Default::default()
    }
}
pub fn membership(entity: EntityId, id: TwitterId) -> Membership {
    Membership {
        entity,
        kind: TWITTER_KIND,
        component: id.component(),
    }
}
pub fn file_membership(entity: EntityId, id: FileId) -> Membership {
    Membership {
        entity,
        kind: FILE_KIND,
        component: id.component(),
    }
}
pub struct Fixture {
    pub session: Session,
    pub kernel: Kernel,
    pub files: FileService,
    pub twitter: TwitterService,
    pub database: PathBuf,
    pub directory: tempfile::TempDir,
}
impl Fixture {
    pub async fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let files = FileService::new(directory.path().join("library"))
            .await
            .unwrap();
        let database = files.root().join("metadata.sqlite");
        let mut session = Session::open(&database).await.unwrap();
        let mut kernel = Kernel::new();
        kernel.register(Arc::new(FileOwner)).unwrap();
        kernel.register(Arc::new(TwitterOwner)).unwrap();
        kernel.initialize(&mut session).await.unwrap();
        files.initialize(&mut session).await.unwrap();
        let twitter = TwitterService::new();
        twitter.initialize(&mut session).await.unwrap();
        Self {
            session,
            kernel,
            files,
            twitter,
            database,
            directory,
        }
    }
    pub async fn component(&mut self) -> (EntityId, TwitterId) {
        let entity = self.kernel.create_entity(&mut self.session).await.unwrap();
        let id = self
            .twitter
            .create(&self.kernel, &mut self.session, snapshot())
            .await
            .unwrap();
        self.kernel
            .attach(&mut self.session, membership(entity, id))
            .await
            .unwrap();
        (entity, id)
    }
    pub async fn file(&mut self, entity: EntityId, name: &str) -> FileId {
        let path = self.directory.path().join(name);
        std::fs::write(&path, b"actual supplied bytes, not necessarily media").unwrap();
        let record = self
            .files
            .admit(&self.kernel, &mut self.session, &path)
            .await
            .unwrap();
        self.kernel
            .attach(&mut self.session, file_membership(entity, record.id))
            .await
            .unwrap();
        record.id
    }
    pub async fn prepare(&mut self, id: TwitterId, file: FileId) -> PreparedAssociation {
        self.twitter
            .prepare_association(&self.kernel, &mut self.session, id, file)
            .await
            .unwrap()
    }
    pub async fn associate(&mut self, id: TwitterId, file: FileId) -> TwitterRecord {
        let prepared = self.prepare(id, file).await;
        match self
            .twitter
            .associate(&self.kernel, &mut self.session, prepared)
            .await
            .unwrap()
        {
            WriteOutcome::Accepted(record) => *record,
            other => panic!("unexpected association {other:?}"),
        }
    }
}
#[derive(QueryableByName)]
struct Count {
    #[diesel(sql_type = BigInt)]
    count: i64,
}
pub async fn count(session: &mut Session, query: &'static str) -> i64 {
    session
        .transaction::<_, TwitterError, _>(move |c| {
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
        .transaction::<_, TwitterError, _>(move |c| {
            Box::pin(async move {
                c.connection().batch_execute(&query).await?;
                Ok(())
            })
        })
        .await
        .unwrap();
}
