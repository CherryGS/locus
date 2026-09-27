use crate::{
    capture::{MAX_PAYLOAD_BYTES, TwitterSnapshot},
    error::TwitterError,
    identity::TwitterId,
    record::TwitterRecord,
    service::TwitterService,
};
use diesel::{
    OptionalExtension, QueryableByName, sql_query,
    sql_types::{BigInt, Binary, Text},
};
use diesel_async::RunQueryDsl;
use locus_file::api::FileId;
use locus_store::api::{Context, Session};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Payload {
    version: u32,
    snapshot: TwitterSnapshot,
    basis: Option<[u8; 16]>,
}
#[derive(QueryableByName)]
struct Row {
    #[diesel(sql_type = Binary)]
    id: Vec<u8>,
    #[diesel(sql_type = BigInt)]
    revision: i64,
    #[diesel(sql_type = Text)]
    payload: String,
}
fn payload(record: &TwitterRecord) -> Result<String, TwitterError> {
    record.snapshot.validate()?;
    let text = serde_json::to_string(&Payload {
        version: 1,
        snapshot: record.snapshot.clone(),
        basis: record.basis.map(|id| *id.as_bytes()),
    })
    .map_err(|e| TwitterError::Corrupt(e.to_string()))?;
    if record.revision < 0 || text.len() > MAX_PAYLOAD_BYTES {
        return Err(TwitterError::Corrupt("revision or payload size".into()));
    }
    Ok(text)
}

impl TwitterService {
    pub async fn read(
        &self,
        session: &mut Session,
        id: TwitterId,
    ) -> Result<TwitterRecord, TwitterError> {
        session
            .transaction(move |c| Box::pin(Self::read_in(c, id)))
            .await
    }
    pub async fn read_in(
        context: &mut Context,
        id: TwitterId,
    ) -> Result<TwitterRecord, TwitterError> {
        let row =
            sql_query("SELECT id, revision, payload FROM locus_twitter_comp_snapshot WHERE id = ?")
                .bind::<Binary, _>(id.as_bytes().as_slice())
                .get_result::<Row>(context.connection())
                .await
                .optional()?
                .ok_or(TwitterError::MissingRecord(id))?;
        let stored_id =
            TwitterId::from_bytes(&row.id).map_err(|e| TwitterError::Corrupt(e.to_string()))?;
        if stored_id != id || row.revision < 0 || row.payload.len() > MAX_PAYLOAD_BYTES {
            return Err(TwitterError::Corrupt(
                "identity, revision or payload size".into(),
            ));
        }
        // Decode only the version first so future formats remain explicitly unsupported,
        // even when their body differs from this version's typed representation.
        let value: serde_json::Value =
            serde_json::from_str(&row.payload).map_err(|e| TwitterError::Corrupt(e.to_string()))?;
        let version = value
            .get("version")
            .and_then(serde_json::Value::as_u64)
            .and_then(|v| u32::try_from(v).ok())
            .ok_or_else(|| TwitterError::Corrupt("invalid payload version".into()))?;
        if version != 1 {
            return Err(TwitterError::PayloadVersion(version));
        }
        let data: Payload =
            serde_json::from_str(&row.payload).map_err(|e| TwitterError::Corrupt(e.to_string()))?;
        data.snapshot
            .validate()
            .map_err(|e| TwitterError::Corrupt(e.to_string()))?;
        let basis = data
            .basis
            .map(|v| FileId::from_bytes(&v))
            .transpose()
            .map_err(|e| TwitterError::Corrupt(e.to_string()))?;
        Ok(TwitterRecord {
            id,
            revision: row.revision,
            snapshot: data.snapshot,
            basis,
        })
    }
}
pub(crate) async fn insert(
    context: &mut Context,
    record: &TwitterRecord,
) -> Result<(), TwitterError> {
    sql_query("INSERT INTO locus_twitter_comp_snapshot (id, revision, payload) VALUES (?, ?, ?)")
        .bind::<Binary, _>(record.id.as_bytes().as_slice())
        .bind::<BigInt, _>(record.revision)
        .bind::<Text, _>(payload(record)?)
        .execute(context.connection())
        .await?;
    crate::query::write(context, record.id.component(), &record.snapshot).await?;
    Ok(())
}
pub(crate) async fn update(
    context: &mut Context,
    record: &TwitterRecord,
) -> Result<(), TwitterError> {
    let record = record.clone();
    // SQLite trigger RAISE(FAIL) can preserve changes made before the error. A
    // participant must restore its old state even when its caller catches that error.
    context
        .savepoint(move |c| Box::pin(async move { update_row(c, &record).await }))
        .await
}
async fn update_row(context: &mut Context, record: &TwitterRecord) -> Result<(), TwitterError> {
    let changed =
        sql_query("UPDATE locus_twitter_comp_snapshot SET revision = ?, payload = ? WHERE id = ?")
            .bind::<BigInt, _>(record.revision)
            .bind::<Text, _>(payload(record)?)
            .bind::<Binary, _>(record.id.as_bytes().as_slice())
            .execute(context.connection())
            .await?;
    if changed != 1 {
        return Err(TwitterError::MissingRecord(record.id));
    }
    crate::query::write(context, record.id.component(), &record.snapshot).await?;
    Ok(())
}
pub(crate) async fn delete(
    context: &mut Context,
    id: TwitterId,
) -> Result<(), diesel::result::Error> {
    sql_query("DELETE FROM locus_twitter_comp_snapshot WHERE id = ?")
        .bind::<Binary, _>(id.as_bytes().as_slice())
        .execute(context.connection())
        .await?;
    Ok(())
}
