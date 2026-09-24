use crate::error::BilibiliError;
use diesel::{QueryableByName, sql_query, sql_types::Integer};
use diesel_async::{RunQueryDsl, SimpleAsyncConnection};
use locus_store::api::Context;

#[derive(QueryableByName)]
struct Version {
    #[diesel(sql_type = Integer)]
    version: i32,
}

pub(crate) async fn initialize(context: &mut Context) -> Result<(), BilibiliError> {
    context.connection().batch_execute("CREATE TABLE IF NOT EXISTS locus_bilibili_schema (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), version INTEGER NOT NULL);").await?;
    for row in sql_query("SELECT version FROM locus_bilibili_schema")
        .load::<Version>(context.connection())
        .await?
    {
        if row.version != 1 {
            return Err(BilibiliError::SchemaVersion(row.version));
        }
    }
    context.connection().batch_execute("CREATE TABLE IF NOT EXISTS locus_bilibili_snapshots (
        id BLOB PRIMARY KEY NOT NULL CHECK(typeof(id) = 'blob' AND length(id) = 16 AND substr(hex(id),13,1) = '7' AND substr(hex(id),17,1) IN ('8','9','A','B')),
        revision INTEGER NOT NULL CHECK(typeof(revision) = 'integer' AND revision >= 0),
        payload TEXT NOT NULL CHECK(typeof(payload) = 'text'));
        INSERT OR IGNORE INTO locus_bilibili_schema VALUES (1,1);").await?;
    Ok(())
}
