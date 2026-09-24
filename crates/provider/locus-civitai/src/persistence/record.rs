use crate::{
    error::CivitaiError, identity::CivitaiId, record::CivitaiRecord, service::CivitaiService,
    snapshot::Snapshot,
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
struct Payload {
    version: u32,
    observation: String,
    basis: [u8; 16],
    snapshot: Snapshot,
    examples: Vec<crate::examples::ExampleBinding>,
}
#[derive(QueryableByName)]
struct Row {
    #[diesel(sql_type=Text)]
    model: String,
    #[diesel(sql_type=Text)]
    matched_version: String,
    #[diesel(sql_type=Text)]
    matched_file: String,
    #[diesel(sql_type=Binary)]
    id: Vec<u8>,
    #[diesel(sql_type=BigInt)]
    revision: i64,
    #[diesel(sql_type=Text)]
    payload: String,
}
#[derive(QueryableByName)]
struct IdRow {
    #[diesel(sql_type=Binary)]
    id: Vec<u8>,
}
pub(crate) async fn model_ids(c: &mut Context, model: u64) -> Result<Vec<CivitaiId>, CivitaiError> {
    sql_query("SELECT id FROM locus_civitai_snapshots WHERE model=? ORDER BY id")
        .bind::<Text, _>(model.to_string())
        .load::<IdRow>(c.connection())
        .await?
        .into_iter()
        .map(|r| CivitaiId::from_bytes(&r.id).map_err(|e| CivitaiError::Invalid(e.to_string())))
        .collect()
}
fn decode(row: Row) -> Result<CivitaiRecord, CivitaiError> {
    let p: Payload =
        serde_json::from_str(&row.payload).map_err(|e| CivitaiError::Invalid(e.to_string()))?;
    if p.version != 1 || row.revision < 0 || uuid::Uuid::parse_str(&p.observation).is_err() {
        return Err(CivitaiError::Invalid(
            "payload version/revision/observation".into(),
        ));
    }
    p.snapshot.validate()?;
    if row.model != p.snapshot.model.id.to_string()
        || row.matched_version != p.snapshot.matched_version.to_string()
        || row.matched_file != p.snapshot.matched_file.to_string()
    {
        return Err(CivitaiError::Invalid(
            "Retained Civitai index disagrees with its snapshot".into(),
        ));
    }
    validate_examples(&p.snapshot, &p.examples)?;
    Ok(CivitaiRecord {
        id: CivitaiId::from_bytes(&row.id).map_err(|e| CivitaiError::Invalid(e.to_string()))?,
        revision: row.revision,
        observation: p.observation,
        basis: FileId::from_bytes(&p.basis).map_err(|e| CivitaiError::Invalid(e.to_string()))?,
        snapshot: p.snapshot,
        examples: p.examples,
    })
}
fn encode(r: &CivitaiRecord) -> Result<String, CivitaiError> {
    r.snapshot.validate()?;
    validate_examples(&r.snapshot, &r.examples)?;
    serde_json::to_string(&Payload {
        version: 1,
        observation: r.observation.clone(),
        basis: *r.basis.as_bytes(),
        snapshot: r.snapshot.clone(),
        examples: r.examples.clone(),
    })
    .map_err(|e| CivitaiError::Invalid(e.to_string()))
}
fn validate_examples(
    snapshot: &Snapshot,
    examples: &[crate::examples::ExampleBinding],
) -> Result<(), CivitaiError> {
    let roster = &snapshot.matched()?.images;
    let mut occurrences = std::collections::HashSet::new();
    for binding in examples {
        if !occurrences.insert(binding.occurrence)
            || roster.get(binding.occurrence) != Some(&binding.representation)
            || uuid::Uuid::parse_str(&binding.acquired_observation).is_err()
            || binding.complete
                && (binding.media.is_empty() || binding.media.iter().any(|m| m.preview_edge == 0))
        {
            return Err(CivitaiError::Invalid(
                "Invalid retained example binding".into(),
            ));
        }
        let mut kinds = std::collections::HashSet::new();
        if binding
            .media
            .iter()
            .any(|m| m.revision < 0 || !kinds.insert(m.image))
        {
            return Err(CivitaiError::Invalid(
                "Invalid retained example Media evidence".into(),
            ));
        }
    }
    Ok(())
}
impl CivitaiService {
    pub async fn read(
        &self,
        s: &mut Session,
        id: CivitaiId,
    ) -> Result<CivitaiRecord, CivitaiError> {
        s.transaction(move |c| Box::pin(Self::read_in(c, id))).await
    }
    pub async fn read_in(c: &mut Context, id: CivitaiId) -> Result<CivitaiRecord, CivitaiError> {
        decode(
            sql_query("SELECT id,revision,model,matched_version,matched_file,payload FROM locus_civitai_snapshots WHERE id=?")
                .bind::<Binary, _>(id.as_bytes().as_slice())
                .get_result::<Row>(c.connection())
                .await
                .optional()?
                .ok_or(CivitaiError::MissingRecord(id))?,
        )
    }
}
pub(crate) async fn model_records(
    c: &mut Context,
    model: u64,
) -> Result<Vec<CivitaiRecord>, CivitaiError> {
    sql_query("SELECT id,revision,model,matched_version,matched_file,payload FROM locus_civitai_snapshots WHERE model=? ORDER BY id")
        .bind::<Text, _>(model.to_string())
        .load::<Row>(c.connection())
        .await?
        .into_iter()
        .map(decode)
        .collect()
}
pub(crate) async fn insert(c: &mut Context, r: &CivitaiRecord) -> Result<(), CivitaiError> {
    sql_query("INSERT INTO locus_civitai_snapshots(id,revision,model,matched_version,matched_file,payload) VALUES(?,?,?,?,?,?)")
        .bind::<Binary,_>(r.id.as_bytes().as_slice()).bind::<BigInt,_>(r.revision).bind::<Text,_>(r.snapshot.model.id.to_string()).bind::<Text,_>(r.snapshot.matched_version.to_string()).bind::<Text,_>(r.snapshot.matched_file.to_string()).bind::<Text,_>(encode(r)?).execute(c.connection()).await?;
    Ok(())
}
pub(crate) async fn update(c: &mut Context, r: &CivitaiRecord) -> Result<(), CivitaiError> {
    let count=sql_query("UPDATE locus_civitai_snapshots SET revision=?,model=?,matched_version=?,matched_file=?,payload=? WHERE id=?")
        .bind::<BigInt,_>(r.revision).bind::<Text,_>(r.snapshot.model.id.to_string()).bind::<Text,_>(r.snapshot.matched_version.to_string()).bind::<Text,_>(r.snapshot.matched_file.to_string()).bind::<Text,_>(encode(r)?).bind::<Binary,_>(r.id.as_bytes().as_slice()).execute(c.connection()).await?;
    if count != 1 {
        return Err(CivitaiError::MissingRecord(r.id));
    }
    Ok(())
}
pub(crate) async fn delete(c: &mut Context, id: CivitaiId) -> Result<(), diesel::result::Error> {
    sql_query("DELETE FROM locus_civitai_snapshots WHERE id=?")
        .bind::<Binary, _>(id.as_bytes().as_slice())
        .execute(c.connection())
        .await?;
    Ok(())
}
