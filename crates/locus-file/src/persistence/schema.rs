use crate::error::FileError;
use diesel::{QueryableByName, sql_query, sql_types::Integer};
use diesel_async::{RunQueryDsl, SimpleAsyncConnection};
use locus_store::api::Context;

#[derive(QueryableByName)]
struct Version {
    #[diesel(sql_type = Integer)]
    version: i32,
}

pub(crate) async fn initialize(context: &mut Context) -> Result<(), FileError> {
    context
        .connection()
        .batch_execute(
            "CREATE TABLE IF NOT EXISTS locus_file_schema (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL);",
        )
        .await?;
    let rows = sql_query("SELECT version FROM locus_file_schema WHERE singleton = 1")
        .load::<Version>(context.connection())
        .await?;
    if let Some(row) = rows.as_slice().first()
        && row.version != 1
    {
        return Err(FileError::SchemaVersion(row.version));
    }
    context
        .connection()
        .batch_execute(
            "CREATE TABLE IF NOT EXISTS locus_files (
        id BLOB NOT NULL PRIMARY KEY CHECK (typeof(id) = 'blob' AND length(id) = 16
            AND substr(hex(id), 13, 1) = '7' AND substr(hex(id), 17, 1) IN ('8', '9', 'A', 'B')),
        relative_path TEXT NOT NULL UNIQUE,
        byte_count INTEGER NOT NULL CHECK (typeof(byte_count) = 'integer' AND byte_count >= 0));
        INSERT OR IGNORE INTO locus_file_schema (singleton, version) VALUES (1, 1);",
        )
        .await?;
    Ok(())
}
