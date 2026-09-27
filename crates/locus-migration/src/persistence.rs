use crate::{error::MigrationError, step::Step};
use diesel::{
    QueryableByName, sql_query,
    sql_types::{BigInt, Text},
};
use diesel_async::{RunQueryDsl, SimpleAsyncConnection};
use locus_store::api::Context;

// Exact DDL recognition prevents accepting a lookalike ledger without its constraints.
const LEDGER: &str = "CREATE TABLE locus_migration_comm_history (id INTEGER PRIMARY KEY NOT NULL CHECK(typeof(id)='integer' AND id>0), checksum TEXT NOT NULL CHECK(typeof(checksum)='text' AND length(checksum)=64), name TEXT NOT NULL CHECK(typeof(name)='text'), applied_at TEXT NOT NULL CHECK(typeof(applied_at)='text'))";
#[derive(QueryableByName)]
struct Object {
    #[diesel(sql_type=Text)]
    name: String,
    #[diesel(sql_type=Text)]
    sql: String,
}
#[derive(QueryableByName)]
struct Row {
    #[diesel(sql_type=BigInt)]
    id: i64,
    #[diesel(sql_type=Text)]
    checksum: String,
    #[diesel(sql_type=Text)]
    id_type: String,
    #[diesel(sql_type=Text)]
    checksum_type: String,
    #[diesel(sql_type=Text)]
    name_type: String,
    #[diesel(sql_type=Text)]
    time_type: String,
}
pub(crate) async fn observe(
    context: &mut Context,
    steps: &[Step],
) -> Result<usize, MigrationError> {
    let objects = sql_query(
        "SELECT name, coalesce(sql,'') AS sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'",
    )
    .load::<Object>(context.connection())
    .await?;
    if objects.is_empty() {
        context.connection().batch_execute(LEDGER).await?;
        return Ok(0);
    }
    let ledger = objects
        .iter()
        .find(|o| o.name == "locus_migration_comm_history")
        .ok_or_else(|| {
            MigrationError::Incompatible(
                "nonempty pre-system database; select a new library".into(),
            )
        })?;
    if ledger.sql != LEDGER {
        return Err(MigrationError::Incompatible(
            "unrecognized ledger schema".into(),
        ));
    }
    let rows = sql_query("SELECT id, checksum, typeof(id) AS id_type, typeof(checksum) AS checksum_type, typeof(name) AS name_type, typeof(applied_at) AS time_type FROM locus_migration_comm_history ORDER BY id")
        .load::<Row>(context.connection()).await?;
    for (index, row) in rows.iter().enumerate() {
        let Some(step) = steps.get(index) else {
            return Err(MigrationError::Incompatible(format!(
                "unknown/newer applied ID {}",
                row.id
            )));
        };
        if row.id_type != "integer"
            || row.checksum_type != "text"
            || row.name_type != "text"
            || row.time_type != "text"
            || row.id != step.id
            || row.checksum != step.checksum()
        {
            return Err(MigrationError::Incompatible(format!(
                "applied ID {} does not match expected ID {} ({})",
                row.id, step.id, step.name
            )));
        }
    }
    Ok(rows.len())
}
pub(crate) async fn record(context: &mut Context, step: &Step) -> Result<(), MigrationError> {
    sql_query("INSERT INTO locus_migration_comm_history(id,checksum,name,applied_at) VALUES(?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
        .bind::<BigInt,_>(step.id).bind::<Text,_>(step.checksum()).bind::<Text,_>(step.name)
        .execute(context.connection()).await?;
    Ok(())
}
