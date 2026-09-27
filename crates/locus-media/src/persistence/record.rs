use crate::{
    error::{AttemptFailure, MediaError},
    identity::{MediaId, MediaKind},
    record::MediaRecord,
    service::MediaService,
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
    basis: Option<[u8; 16]>,
    last_failure: Option<AttemptFailure>,
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

fn table(kind: MediaKind) -> &'static str {
    match kind {
        MediaKind::Image => "locus_media_comp_image",
        MediaKind::Video => "locus_media_comp_video",
    }
}

fn payload(record: &MediaRecord) -> Result<String, MediaError> {
    record.validate()?;
    serde_json::to_string(&Payload {
        version: 2,
        basis: record.basis.map(|v| *v.as_bytes()),
        last_failure: record.last_failure.clone(),
    })
    .map_err(|e| MediaError::Corrupt(e.to_string()))
}
impl MediaService {
    pub async fn read(
        &self,
        session: &mut Session,
        id: impl Into<MediaId>,
    ) -> Result<MediaRecord, MediaError> {
        let id = id.into();
        session
            .transaction(move |c| Box::pin(Self::read_in(c, id)))
            .await
    }
    pub async fn read_in(context: &mut Context, id: MediaId) -> Result<MediaRecord, MediaError> {
        let row = sql_query(format!(
            "SELECT id, revision, payload FROM {} WHERE id = ?",
            table(id.kind())
        ))
        .bind::<Binary, _>(id.component().as_bytes().as_slice())
        .get_result::<Row>(context.connection())
        .await
        .optional()?
        .ok_or(MediaError::MissingRecord(id))?;
        if locus_core::api::ComponentId::from_bytes(&row.id)? != id.component() {
            return Err(MediaError::Corrupt("ID mismatch".into()));
        }
        let payload: Payload =
            serde_json::from_str(&row.payload).map_err(|e| MediaError::Corrupt(e.to_string()))?;
        if payload.version != 2 {
            return Err(MediaError::Corrupt("payload version".into()));
        }
        let record = MediaRecord {
            id,
            revision: row.revision,
            basis: payload.basis.map(|v| FileId::from_bytes(&v)).transpose()?,
            facts: super::common::Common::read(context, id)
                .await?
                .facts(id.kind())?,
            last_failure: payload.last_failure,
        };
        record.validate()?;
        Ok(record)
    }
}

pub(crate) async fn insert(context: &mut Context, record: &MediaRecord) -> Result<(), MediaError> {
    sql_query(format!(
        "INSERT INTO {} (id,revision,payload) VALUES (?,0,?)",
        table(record.id.kind())
    ))
    .bind::<Binary, _>(record.id.component().as_bytes().as_slice())
    .bind::<Text, _>(payload(record)?)
    .execute(context.connection())
    .await?;

    super::common::write(context, record.id, &record.facts).await?;
    Ok(())
}

pub(crate) async fn update(context: &mut Context, record: &MediaRecord) -> Result<(), MediaError> {
    let record = record.clone();
    context
        .savepoint(move |c| Box::pin(async move { update_row(c, &record).await }))
        .await
}
async fn update_row(context: &mut Context, record: &MediaRecord) -> Result<(), MediaError> {
    sql_query(format!(
        "UPDATE {} SET revision = ?, payload = ? WHERE id = ?",
        table(record.id.kind())
    ))
    .bind::<BigInt, _>(record.revision)
    .bind::<Text, _>(payload(record)?)
    .bind::<Binary, _>(record.id.component().as_bytes().as_slice())
    .execute(context.connection())
    .await?;

    super::common::write(context, record.id, &record.facts).await?;
    Ok(())
}

pub(crate) async fn delete(
    context: &mut Context,
    id: MediaId,
) -> Result<(), diesel::result::Error> {
    sql_query(format!("DELETE FROM {} WHERE id = ?", table(id.kind())))
        .bind::<Binary, _>(id.component().as_bytes().as_slice())
        .execute(context.connection())
        .await?;
    Ok(())
}
