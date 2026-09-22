use crate::{
    error::SettingsError,
    identity::GroupId,
    persistence::{self, Row},
    provider::Registry,
    record::{Observation, SavedValue, WriteOutcome},
};
use locus_store::api::{Context, Session};
use serde_json::Value;

#[derive(Clone)]
pub struct SettingsService {
    registry: Registry,
}
impl SettingsService {
    pub fn new(registry: Registry) -> Self {
        Self { registry }
    }
    pub fn registry(&self) -> &Registry {
        &self.registry
    }
    pub async fn initialize_schema(&self, session: &mut Session) -> Result<(), SettingsError> {
        session
            .transaction(|ctx| Box::pin(persistence::initialize(ctx)))
            .await
    }
    pub async fn read(
        &self,
        session: &mut Session,
        id: GroupId,
    ) -> Result<Observation, SettingsError> {
        let service = self.clone();
        session
            .transaction(move |ctx| Box::pin(async move { service.read_in(ctx, id).await }))
            .await
    }
    pub async fn read_in(
        &self,
        ctx: &mut Context,
        id: GroupId,
    ) -> Result<Observation, SettingsError> {
        let row = persistence::read(ctx, id).await?;
        self.observe(id, row)
    }
    fn observe(&self, id: GroupId, row: Option<Row>) -> Result<Observation, SettingsError> {
        let group_id = id.to_string();
        if let Some(row) = row.as_ref()
            && row.metadata().is_none()
        {
            return Ok(Observation::Corrupt {
                group_id,
                version: row.version(),
                revision: row.revision(),
                message: "invalid outer settings metadata".into(),
            });
        }
        let provider = match self.registry.provider(id) {
            Ok(p) => p,
            Err(SettingsError::Unavailable(_)) => {
                return Ok(Observation::Unavailable {
                    group_id,
                    metadata: row.and_then(|r| r.metadata()),
                });
            }
            Err(e) => return Err(e),
        };
        let Some(row) = row else {
            return Ok(Observation::Absent { group_id });
        };
        let Some(metadata) = row.metadata() else {
            return Ok(Observation::Corrupt {
                group_id,
                version: row.version(),
                revision: row.revision(),
                message: "invalid outer settings metadata".into(),
            });
        };
        if row.payload_storage != "text" {
            return Ok(Observation::Invalid {
                group_id,
                metadata,
                message: "payload is not SQLite text".into(),
            });
        }
        let definition = provider.definition()?;
        if metadata.version != i64::from(definition.version) && !provider.supports(metadata.version)
        {
            return Ok(Observation::Unsupported { group_id, metadata });
        }
        let value = serde_json::from_str::<Value>(&row.payload)
            .map_err(|e| SettingsError::Invalid(e.to_string()));
        let result = value.and_then(|v| {
            if metadata.version == i64::from(definition.version) {
                provider.validate(v)
            } else {
                provider.convert(metadata.version, v)
            }
        });
        match result {
            Err(error) => Ok(Observation::Invalid {
                group_id,
                metadata,
                message: error.to_string(),
            }),
            Ok(_) if metadata.version != i64::from(definition.version) => {
                Ok(Observation::ConversionRequired {
                    group_id,
                    metadata,
                    source: row.payload,
                })
            }
            Ok(value) => Ok(Observation::Current {
                saved: SavedValue {
                    group_id,
                    metadata,
                    value,
                },
            }),
        }
    }
    pub async fn initialize(
        &self,
        session: &mut Session,
        id: GroupId,
    ) -> Result<WriteOutcome, SettingsError> {
        let service = self.clone();
        session
            .transaction(move |ctx| Box::pin(async move { service.initialize_in(ctx, id).await }))
            .await
    }
    /// Provisional participant: no saved success until the caller commits.
    pub async fn initialize_in(
        &self,
        ctx: &mut Context,
        id: GroupId,
    ) -> Result<WriteOutcome, SettingsError> {
        let definition = self.registry.provider(id)?.definition()?;
        let row = persistence::read(ctx, id).await?;
        if row.is_some() {
            return Ok(WriteOutcome::Existing(self.observe(id, row)?));
        }
        self.write(ctx, id, definition.defaults, true).await
    }
    pub async fn update(
        &self,
        session: &mut Session,
        id: GroupId,
        revision: String,
        value: Value,
    ) -> Result<WriteOutcome, SettingsError> {
        let service = self.clone();
        session
            .transaction(move |ctx| {
                Box::pin(async move { service.update_in(ctx, id, &revision, value).await })
            })
            .await
    }
    /// Provisional participant. The expected revision belongs to this caller's library.
    pub async fn update_in(
        &self,
        ctx: &mut Context,
        id: GroupId,
        revision: &str,
        value: Value,
    ) -> Result<WriteOutcome, SettingsError> {
        let value = self.registry.provider(id)?.validate(value)?;
        let row = persistence::read(ctx, id).await?;
        if !row
            .as_ref()
            .is_some_and(|r| r.revision().as_deref() == Some(revision))
        {
            return Ok(WriteOutcome::Conflict(self.observe(id, row)?));
        }
        self.write(ctx, id, value, false).await
    }
    pub async fn reset(
        &self,
        session: &mut Session,
        id: GroupId,
        revision: String,
    ) -> Result<WriteOutcome, SettingsError> {
        let value = self.registry.provider(id)?.definition()?.defaults;
        self.update(session, id, revision, value).await
    }
    pub async fn convert(
        &self,
        session: &mut Session,
        id: GroupId,
        metadata: crate::record::Metadata,
        source: String,
    ) -> Result<WriteOutcome, SettingsError> {
        let service = self.clone();
        session
            .transaction(move |ctx| {
                Box::pin(async move { service.convert_in(ctx, id, metadata, source).await })
            })
            .await
    }
    /// Provisional participant guarded by the entire observed source representation.
    pub async fn convert_in(
        &self,
        ctx: &mut Context,
        id: GroupId,
        metadata: crate::record::Metadata,
        source: String,
    ) -> Result<WriteOutcome, SettingsError> {
        let provider = self.registry.provider(id)?;
        let row = persistence::read(ctx, id).await?;
        if !row
            .as_ref()
            .is_some_and(|r| r.metadata().as_ref() == Some(&metadata) && r.payload == source)
        {
            return Ok(WriteOutcome::Conflict(self.observe(id, row)?));
        }
        let value = provider.convert(
            metadata.version,
            serde_json::from_str(&source).map_err(|e| SettingsError::Invalid(e.to_string()))?,
        )?;
        self.write(ctx, id, value, false).await
    }
    async fn write(
        &self,
        ctx: &mut Context,
        id: GroupId,
        value: Value,
        insert: bool,
    ) -> Result<WriteOutcome, SettingsError> {
        let provider = self.registry.provider(id)?;
        let value = provider.validate(value)?;
        let metadata = crate::record::Metadata {
            version: i64::from(provider.definition()?.version),
            revision: uuid::Uuid::now_v7().to_string(),
        };
        let payload =
            serde_json::to_string(&value).map_err(|e| SettingsError::Invalid(e.to_string()))?;
        if insert {
            persistence::insert(ctx, id, &metadata, &payload).await?;
        } else {
            persistence::replace(ctx, id, &metadata, &payload).await?;
        }
        Ok(WriteOutcome::Saved(SavedValue {
            group_id: id.to_string(),
            metadata,
            value,
        }))
    }
}
