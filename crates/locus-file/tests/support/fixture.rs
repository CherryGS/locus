use diesel::{QueryableByName, sql_query, sql_types::BigInt};
use diesel_async::{RunQueryDsl, SimpleAsyncConnection};
use locus_core::api::Kernel;
use locus_file::api::{FileError, FileOwner, FileService};
use locus_store::api::Session;
use std::{path::PathBuf, sync::Arc};

pub struct Fixture {
    pub source: PathBuf,
    pub database: PathBuf,
    pub files: FileService,
    pub kernel: Kernel,
    pub session: Session,
    // Drop the SQLite connection before removing its directory on Windows.
    pub directory: tempfile::TempDir,
}
impl Fixture {
    pub async fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("incoming.dat");
        std::fs::write(&source, b"input bytes\0\xff").unwrap();
        let files = FileService::new(directory.path().join("library"))
            .await
            .unwrap();
        let database = files.root().join("metadata.sqlite");
        let mut session = Session::open(&database).await.unwrap();
        let mut kernel = Kernel::new();
        kernel.register(Arc::new(FileOwner)).unwrap();
        locus_migration::api::migrate(&mut session).await.unwrap();
        Self {
            directory,
            source,
            database,
            files,
            kernel,
            session,
        }
    }
}
#[derive(QueryableByName)]
pub struct Count {
    #[diesel(sql_type = BigInt)]
    pub count: i64,
}
pub async fn count(session: &mut Session, sql: &'static str) -> i64 {
    session
        .transaction::<_, FileError, _>(move |context| {
            Box::pin(async move {
                Ok(sql_query(sql)
                    .get_result::<Count>(context.connection())
                    .await?
                    .count)
            })
        })
        .await
        .unwrap()
}
#[allow(dead_code)] // Shared by multiple integration-test crates.
pub async fn execute(session: &mut Session, sql: &'static str) {
    session
        .transaction::<_, FileError, _>(move |context| {
            Box::pin(async move {
                context.connection().batch_execute(sql).await?;
                Ok(())
            })
        })
        .await
        .unwrap();
}
