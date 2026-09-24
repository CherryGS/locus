use crate::error::CivitaiError;
use diesel::{QueryableByName, sql_query, sql_types::Integer};
use diesel_async::{RunQueryDsl, SimpleAsyncConnection};
use locus_store::api::Context;
#[derive(QueryableByName)]
struct Version {
    #[diesel(sql_type = Integer)]
    version: i32,
}
pub(crate) async fn initialize(c: &mut Context) -> Result<(), CivitaiError> {
    c.connection().batch_execute("CREATE TABLE IF NOT EXISTS locus_civitai_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL);").await?;
    for row in sql_query("SELECT version FROM locus_civitai_schema")
        .load::<Version>(c.connection())
        .await?
    {
        if row.version != 1 {
            return Err(CivitaiError::Invalid(format!(
                "unsupported schema {}",
                row.version
            )));
        }
    }
    c.connection().batch_execute("CREATE TABLE IF NOT EXISTS locus_civitai_snapshots (
        id BLOB PRIMARY KEY NOT NULL CHECK(length(id)=16),
        revision INTEGER NOT NULL CHECK(revision>=0),
        model TEXT NOT NULL, matched_version TEXT NOT NULL, matched_file TEXT NOT NULL,
        payload TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS locus_civitai_model ON locus_civitai_snapshots(model,matched_version,matched_file);
        INSERT OR IGNORE INTO locus_civitai_schema VALUES(1,1);").await?;
    Ok(())
}
