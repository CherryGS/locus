use super::{registry::Shared, submissions::Arguments};
use crate::api::{
    dto::MutationOutcome,
    error::ApiError,
    settings::{dto::*, mapping as map},
};
use locus_settings::api::{GroupId, Metadata, WriteOutcome};
use std::sync::Arc;
impl Shared {
    pub async fn settings_definitions(
        self: &Arc<Self>,
    ) -> Result<Vec<SettingsDefinition>, ApiError> {
        self.query("Settings definitions", move |_| async move {
            crate::api::settings::settings_definitions()
                .map_err(|e| ApiError::invalid(e.to_string()))
        })
        .await
    }
    pub async fn media_settings_runtime(
        self: &Arc<Self>,
    ) -> Result<MediaSettingsRuntime, ApiError> {
        let value = self.domain.media_settings.clone();
        self.query(
            "Media runtime configuration",
            move |_| async move { Ok(value) },
        )
        .await
    }
    pub async fn settings_read(
        self: &Arc<Self>,
        id: GroupId,
    ) -> Result<SettingsObservation, ApiError> {
        let domain = self.domain.clone();
        self.query("Read settings", move |task| async move {
            let mut session = domain
                .database
                .session(&task)
                .await
                .map_err(|e| ApiError::domain(map::failure(e.into())))?;
            domain
                .settings
                .read(&mut session, id)
                .await
                .map(map::observation)
                .map_err(|e| ApiError::domain(map::failure(e)))
        })
        .await
    }
    pub async fn settings_change(
        self: &Arc<Self>,
        id: GroupId,
        input: ChangeSettings,
    ) -> Result<MutationOutcome, ApiError> {
        let domain = self.domain.clone();
        self.mutation(
            input.request_id.clone(),
            Arguments::Settings {
                group: id,
                change: input.change.clone(),
            },
            "Change settings",
            move |task| async move {
                let result = async {
                    let mut session = domain
                        .database
                        .session(&task)
                        .await
                        .map_err(locus_settings::api::SettingsError::from)?;
                    match input.change {
                        SettingsChange::Initialize => {
                            domain.settings.initialize(&mut session, id).await
                        }
                        SettingsChange::Update {
                            expected_revision,
                            value,
                        } => {
                            domain
                                .settings
                                .update(&mut session, id, expected_revision, value)
                                .await
                        }
                        SettingsChange::Reset { expected_revision } => {
                            domain
                                .settings
                                .reset(&mut session, id, expected_revision)
                                .await
                        }
                        SettingsChange::Convert { metadata, source } => {
                            domain
                                .settings
                                .convert(
                                    &mut session,
                                    id,
                                    Metadata {
                                        version: parse_version(&metadata.version)?,
                                        revision: metadata.revision,
                                    },
                                    source,
                                )
                                .await
                        }
                    }
                }
                .await;
                match result {
                    Ok(WriteOutcome::Saved(value)) => MutationOutcome::SettingsSaved {
                        saved: map::saved(value),
                    },
                    Ok(WriteOutcome::Existing(current)) => MutationOutcome::SettingsExisting {
                        current: map::observation(current),
                    },
                    Ok(WriteOutcome::Conflict(current)) => MutationOutcome::SettingsConflict {
                        current: map::observation(current),
                    },
                    Err(error) => MutationOutcome::Failed {
                        diagnostic: map::failure(error),
                    },
                }
            },
        )
        .await
    }
}

fn parse_version(value: &str) -> Result<i64, locus_settings::api::SettingsError> {
    let parsed = value
        .parse::<i64>()
        .map_err(|e| locus_settings::api::SettingsError::Invalid(e.to_string()))?;
    if parsed.to_string() != value {
        return Err(locus_settings::api::SettingsError::Invalid(
            "version must be a canonical decimal integer".into(),
        ));
    }
    Ok(parsed)
}
