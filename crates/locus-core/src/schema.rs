use diesel::{QueryableByName, sql_query, sql_types::Integer};
use diesel_async::{RunQueryDsl, SimpleAsyncConnection};
use locus_store::Context;

use crate::CoreError;

#[derive(QueryableByName)]
struct SchemaVersion {
    #[diesel(sql_type = Integer)]
    version: i32,
}

pub(crate) async fn initialize(context: &mut Context) -> Result<(), CoreError> {
    context
        .connection()
        .batch_execute(
            "CREATE TABLE IF NOT EXISTS locus_core_schema (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            version INTEGER NOT NULL
        );",
        )
        .await?;
    let versions = sql_query("SELECT version FROM locus_core_schema WHERE singleton = 1")
        .load::<SchemaVersion>(context.connection())
        .await?;
    if let Some(version) = versions.as_slice().first()
        && version.version != 1
    {
        return Err(CoreError::SchemaVersion(version.version));
    }
    context.connection().batch_execute(
        "CREATE TABLE IF NOT EXISTS locus_entities (
            id BLOB NOT NULL PRIMARY KEY CHECK (typeof(id) = 'blob' AND length(id) = 16
                AND substr(hex(id), 13, 1) = '7' AND substr(hex(id), 17, 1) IN ('8', '9', 'A', 'B'))
        );
        CREATE TABLE IF NOT EXISTS locus_components (
            id BLOB NOT NULL PRIMARY KEY CHECK (typeof(id) = 'blob' AND length(id) = 16
                AND substr(hex(id), 13, 1) = '7' AND substr(hex(id), 17, 1) IN ('8', '9', 'A', 'B')),
            kind BLOB NOT NULL CHECK (typeof(kind) = 'blob' AND length(kind) = 16),
            UNIQUE (id, kind)
        );
        CREATE TABLE IF NOT EXISTS locus_memberships (
            entity BLOB NOT NULL,
            kind BLOB NOT NULL,
            component BLOB NOT NULL,
            PRIMARY KEY (entity, kind),
            FOREIGN KEY (entity) REFERENCES locus_entities(id) ON DELETE CASCADE,
            FOREIGN KEY (component, kind) REFERENCES locus_components(id, kind) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS locus_memberships_component ON locus_memberships(component);
        INSERT OR IGNORE INTO locus_core_schema (singleton, version) VALUES (1, 1);"
    ).await?;
    Ok(())
}
