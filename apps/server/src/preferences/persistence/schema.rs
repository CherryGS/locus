use diesel::{
    QueryableByName, sql_query,
    sql_types::{BigInt, Text},
};
use diesel_async::{RunQueryDsl, SimpleAsyncConnection};
use locus_store::api::Context;

use super::super::error::PreferenceError;

#[derive(QueryableByName)]
struct Version {
    #[diesel(sql_type = BigInt)]
    singleton: i64,
    #[diesel(sql_type = BigInt)]
    version: i64,
    #[diesel(sql_type = Text)]
    storage_type: String,
}

pub(in crate::preferences) async fn initialize(
    context: &mut Context,
) -> Result<(), PreferenceError> {
    context
        .connection()
        .batch_execute(
            "CREATE TABLE IF NOT EXISTS locus_preferences_schema (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            version INTEGER NOT NULL CHECK (typeof(version) = 'integer'));",
        )
        .await?;
    let rows = sql_query(
        "SELECT singleton, version, typeof(version) AS storage_type FROM locus_preferences_schema",
    )
    .load::<Version>(context.connection())
    .await?;
    if rows.len() > 1
        || rows
            .iter()
            .any(|row| row.singleton != 1 || row.storage_type != "integer")
    {
        return Err(PreferenceError::CorruptSchema(
            "invalid version rows".into(),
        ));
    }
    if let Some(row) = rows.as_slice().first()
        && row.version != 1
    {
        return Err(PreferenceError::SchemaVersion(row.version));
    }
    context.connection().batch_execute(
        "CREATE TABLE IF NOT EXISTS locus_entity_view_preferences (
            entity_id BLOB NOT NULL PRIMARY KEY CHECK (typeof(entity_id) = 'blob' AND length(entity_id) = 16
                AND substr(hex(entity_id), 13, 1) = '7' AND substr(hex(entity_id), 17, 1) IN ('8', '9', 'A', 'B')),
            view_definition_id TEXT NOT NULL CHECK (typeof(view_definition_id) = 'text' AND length(view_definition_id) > 0),
            revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision > 0));
         INSERT OR IGNORE INTO locus_preferences_schema (singleton, version) VALUES (1, 1);")
        .await?;
    Ok(())
}
