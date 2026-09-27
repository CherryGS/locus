use crate::{error::SettingsError, identity::GroupId, record::Metadata};
use diesel::{
    QueryableByName, sql_query,
    sql_types::{BigInt, Text},
};
use diesel_async::RunQueryDsl;
use locus_store::api::Context;
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
pub(crate) async fn read(context: &mut Context, id: GroupId) -> Result<Option<Row>, SettingsError> {
    let rows=sql_query("SELECT COALESCE(CAST(version AS TEXT),'') AS version, CASE WHEN typeof(revision)='text' THEN revision ELSE '' END AS revision, CASE WHEN typeof(payload)='text' THEN payload ELSE '' END AS payload, typeof(version) AS version_storage, typeof(revision) AS revision_storage, typeof(payload) AS payload_storage FROM locus_settings_comm_group_value WHERE group_id=?").bind::<Text,_>(id.to_string()).load::<Row>(context.connection()).await?;
    Ok(rows.into_iter().next())
}
pub(crate) async fn insert(
    context: &mut Context,
    id: GroupId,
    metadata: &Metadata,
    payload: &str,
) -> Result<(), SettingsError> {
    sql_query(
        "INSERT INTO locus_settings_comm_group_value(group_id,version,revision,payload) VALUES(?,?,?,?)",
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
    sql_query("UPDATE locus_settings_comm_group_value SET version=?,revision=?,payload=? WHERE group_id=?")
        .bind::<BigInt, _>(metadata.version)
        .bind::<Text, _>(&metadata.revision)
        .bind::<Text, _>(payload)
        .bind::<Text, _>(id.to_string())
        .execute(context.connection())
        .await?;
    Ok(())
}
