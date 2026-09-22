use crate::{error::SettingsError, identity::GroupId, record::Metadata};
use diesel::{
    QueryableByName, sql_query,
    sql_types::{BigInt, Text},
};
use diesel_async::{RunQueryDsl, SimpleAsyncConnection};
use locus_store::api::Context;
#[derive(QueryableByName)]
struct Schema {
    #[diesel(sql_type=Text)]
    version: String,
    #[diesel(sql_type=Text)]
    storage: String,
}
#[derive(QueryableByName)]
pub(crate) struct Row {
    #[diesel(sql_type=Text)]
    pub version: String,
    #[diesel(sql_type=Text)]
    pub revision: String,
    #[diesel(sql_type=Text)]
    pub payload: String,
    #[diesel(sql_type=Text)]
    pub version_storage: String,
    #[diesel(sql_type=Text)]
    pub revision_storage: String,
    #[diesel(sql_type=Text)]
    pub payload_storage: String,
}
impl Row {
    pub fn version(&self) -> Option<i64> {
        (self.version_storage == "integer")
            .then(|| self.version.parse().ok())
            .flatten()
    }
    pub fn revision(&self) -> Option<String> {
        if self.revision_storage != "text" {
            return None;
        }
        let id = uuid::Uuid::parse_str(&self.revision).ok()?;
        (id.to_string() == self.revision && id.get_version_num() == 7)
            .then(|| self.revision.clone())
    }
    pub fn metadata(&self) -> Option<Metadata> {
        Some(Metadata {
            version: self.version()?,
            revision: self.revision()?,
        })
    }
}
async fn check_schema(context: &mut Context) -> Result<(), SettingsError> {
    let rows=sql_query("SELECT CAST(version AS TEXT) AS version, typeof(version) AS storage FROM locus_settings_schema WHERE singleton=1").load::<Schema>(context.connection()).await?;
    let Some(schema) = rows.as_slice().first() else {
        return Err(SettingsError::CorruptSchema(
            "missing settings schema marker".into(),
        ));
    };
    if schema.storage != "integer" {
        return Err(SettingsError::CorruptSchema(
            "invalid settings schema marker storage".into(),
        ));
    }
    let version = schema
        .version
        .parse::<i64>()
        .map_err(|e| SettingsError::CorruptSchema(e.to_string()))?;
    if version != 1 {
        return Err(SettingsError::SchemaVersion(version));
    }
    Ok(())
}
pub(crate) async fn initialize(context: &mut Context) -> Result<(), SettingsError> {
    // An existing table with a missing marker is corruption, not a fresh schema.
    #[derive(QueryableByName)]
    struct Count {
        #[diesel(sql_type=BigInt)]
        count: i64,
    }
    let count=sql_query("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('locus_settings_schema','locus_settings_values')").get_result::<Count>(context.connection()).await?.count;
    if count == 0 {
        context.connection().batch_execute("CREATE TABLE locus_settings_schema (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL); INSERT INTO locus_settings_schema VALUES(1,1); CREATE TABLE locus_settings_values (group_id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL, revision TEXT NOT NULL, payload TEXT NOT NULL);").await?;
    }
    check_schema(context).await?;
    // Existing schema must include the table; never repair it implicitly.
    sql_query("SELECT count(*) AS count FROM locus_settings_values")
        .get_result::<Count>(context.connection())
        .await?;
    Ok(())
}
pub(crate) async fn read(context: &mut Context, id: GroupId) -> Result<Option<Row>, SettingsError> {
    check_schema(context).await?;
    let rows=sql_query("SELECT COALESCE(CAST(version AS TEXT),'') AS version, CASE WHEN typeof(revision)='text' THEN revision ELSE '' END AS revision, CASE WHEN typeof(payload)='text' THEN payload ELSE '' END AS payload, typeof(version) AS version_storage, typeof(revision) AS revision_storage, typeof(payload) AS payload_storage FROM locus_settings_values WHERE group_id=?").bind::<Text,_>(id.to_string()).load::<Row>(context.connection()).await?;
    Ok(rows.into_iter().next())
}
pub(crate) async fn insert(
    context: &mut Context,
    id: GroupId,
    metadata: &Metadata,
    payload: &str,
) -> Result<(), SettingsError> {
    sql_query(
        "INSERT INTO locus_settings_values(group_id,version,revision,payload) VALUES(?,?,?,?)",
    )
    .bind::<Text, _>(id.to_string())
    .bind::<BigInt, _>(metadata.version)
    .bind::<Text, _>(&metadata.revision)
    .bind::<Text, _>(payload)
    .execute(context.connection())
    .await?;
    Ok(())
}
pub(crate) async fn replace(
    context: &mut Context,
    id: GroupId,
    metadata: &Metadata,
    payload: &str,
) -> Result<(), SettingsError> {
    // Caller established the valid guard in this same BEGIN IMMEDIATE unit.
    sql_query("UPDATE locus_settings_values SET version=?,revision=?,payload=? WHERE group_id=?")
        .bind::<BigInt, _>(metadata.version)
        .bind::<Text, _>(&metadata.revision)
        .bind::<Text, _>(payload)
        .bind::<Text, _>(id.to_string())
        .execute(context.connection())
        .await?;
    Ok(())
}
