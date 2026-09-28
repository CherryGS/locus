use diesel::{
    QueryableByName, sql_query,
    sql_types::{Integer, Text},
};
use diesel_async::RunQueryDsl;
use locus_query::api::Source;
use locus_store::api::{Context, Session, StoreError};
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum FilterError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("preset storage: {0}")]
    Database(#[from] diesel::result::Error),
    #[error("preset name must not be blank")]
    BlankName,
    #[error("preset name already exists")]
    DuplicateName,
    #[error("preset is absent")]
    Absent,
    #[error("preset changed since it was read")]
    Conflict,
    #[error("invalid source envelope")]
    Envelope,
}
#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub revision: String,
    pub source: Source,
}
#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
pub struct PresetSummary {
    pub id: String,
    pub name: String,
    pub revision: String,
}
#[derive(QueryableByName)]
struct Row {
    #[diesel(sql_type = Text)]
    id: String,
    #[diesel(sql_type = Text)]
    name: String,
    #[diesel(sql_type = Text)]
    revision: String,
    #[diesel(sql_type = Text)]
    format: String,
    #[diesel(sql_type = Integer)]
    version: i32,
    #[diesel(sql_type = Text)]
    source: String,
}
impl From<Row> for Preset {
    fn from(row: Row) -> Self {
        Self {
            id: row.id,
            name: row.name,
            revision: row.revision,
            source: Source {
                format: row.format,
                version: row.version as u32,
                text: row.source,
            },
        }
    }
}
#[derive(Clone, Default)]
pub struct FilterService;
impl FilterService {
    pub async fn list(&self, session: &mut Session) -> Result<Vec<PresetSummary>, FilterError> {
        session.transaction(|c| Box::pin(Self::list_in(c))).await
    }
    pub async fn list_in(c: &mut Context) -> Result<Vec<PresetSummary>, FilterError> {
        #[derive(QueryableByName)]
        struct Summary {
            #[diesel(sql_type = Text)]
            id: String,
            #[diesel(sql_type = Text)]
            name: String,
            #[diesel(sql_type = Text)]
            revision: String,
        }
        Ok(sql_query(
            "SELECT id,name,revision FROM locus_filter_comm_preset ORDER BY name COLLATE BINARY,id",
        )
        .load::<Summary>(c.connection())
        .await?
        .into_iter()
        .map(|r| PresetSummary {
            id: r.id,
            name: r.name,
            revision: r.revision,
        })
        .collect())
    }
    pub async fn read_in(c: &mut Context, id: &str) -> Result<Preset, FilterError> {
        sql_query("SELECT id,name,revision,format,version,source FROM locus_filter_comm_preset WHERE id=?")
            .bind::<Text,_>(id).load::<Row>(c.connection()).await?.into_iter().next().map(Into::into).ok_or(FilterError::Absent)
    }
    pub async fn create_in(
        c: &mut Context,
        name: &str,
        source: Source,
    ) -> Result<Preset, FilterError> {
        let record = Self::record(uuid::Uuid::now_v7().to_string(), name, source)?;
        sql_query("INSERT INTO locus_filter_comm_preset(id,name,revision,format,version,source) VALUES (?,?,?,?,?,?)")
            .bind::<Text,_>(&record.id).bind::<Text,_>(&record.name).bind::<Text,_>(&record.revision)
            .bind::<Text,_>(&record.source.format).bind::<Integer,_>(record.source.version as i32).bind::<Text,_>(&record.source.text)
            .execute(c.connection()).await.map_err(storage)?;
        Ok(record)
    }
    pub async fn update_in(
        c: &mut Context,
        id: &str,
        revision: &str,
        name: &str,
        source: Source,
    ) -> Result<Preset, FilterError> {
        Self::observe(c, id, revision).await?;
        let record = Self::record(id.into(), name, source)?;
        sql_query("UPDATE locus_filter_comm_preset SET name=?,revision=?,format=?,version=?,source=? WHERE id=? AND revision=?")
            .bind::<Text,_>(&record.name).bind::<Text,_>(&record.revision).bind::<Text,_>(&record.source.format)
            .bind::<Integer,_>(record.source.version as i32).bind::<Text,_>(&record.source.text)
            .bind::<Text,_>(id).bind::<Text,_>(revision).execute(c.connection()).await.map_err(storage)?;
        Ok(record)
    }
    pub async fn rename_in(
        c: &mut Context,
        id: &str,
        revision: &str,
        name: &str,
    ) -> Result<Preset, FilterError> {
        let current = Self::observe(c, id, revision).await?;
        Self::update_in(c, id, revision, name, current.source).await
    }
    pub async fn copy_in(c: &mut Context, id: &str, name: &str) -> Result<Preset, FilterError> {
        let current = Self::read_in(c, id).await?;
        Self::create_in(c, name, current.source).await
    }
    pub async fn delete_in(c: &mut Context, id: &str, revision: &str) -> Result<(), FilterError> {
        Self::observe(c, id, revision).await?;
        sql_query("DELETE FROM locus_filter_comm_preset WHERE id=? AND revision=?")
            .bind::<Text, _>(id)
            .bind::<Text, _>(revision)
            .execute(c.connection())
            .await?;
        Ok(())
    }
    async fn observe(c: &mut Context, id: &str, revision: &str) -> Result<Preset, FilterError> {
        let current = Self::read_in(c, id).await?;
        if current.revision != revision {
            return Err(FilterError::Conflict);
        }
        Ok(current)
    }
    fn record(id: String, name: &str, source: Source) -> Result<Preset, FilterError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(FilterError::BlankName);
        }
        if source.format.is_empty() || source.version == 0 || source.version > i32::MAX as u32 {
            return Err(FilterError::Envelope);
        }
        Ok(Preset {
            id,
            name: name.into(),
            revision: uuid::Uuid::now_v7().to_string(),
            source,
        })
    }
}
fn storage(error: diesel::result::Error) -> FilterError {
    if matches!(
        error,
        diesel::result::Error::DatabaseError(diesel::result::DatabaseErrorKind::UniqueViolation, _)
    ) {
        FilterError::DuplicateName
    } else {
        error.into()
    }
}
