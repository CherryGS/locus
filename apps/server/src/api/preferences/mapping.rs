use super::dto::{EntityViewPreference, PreferenceFailure, SavedViewPreference};
use crate::{
    api::{
        core::mapping::core_failure,
        error::{ApiError, DomainDiagnostic},
        store,
    },
    preferences::{
        error::PreferenceError,
        identity::{SavedRevision, ViewDefinitionId},
        record::{Observation, SavedPreference},
    },
};

pub(crate) fn input(
    view: String,
    revision: Option<&str>,
) -> Result<(ViewDefinitionId, Option<SavedRevision>), ApiError> {
    let view = ViewDefinitionId::new(view).map_err(|error| ApiError::invalid(error.to_string()))?;
    let revision = revision
        .map(SavedRevision::from_decimal)
        .transpose()
        .map_err(|error| ApiError::invalid(error.to_string()))?;
    Ok((view, revision))
}

pub(crate) fn saved(value: SavedPreference) -> SavedViewPreference {
    SavedViewPreference {
        entity_id: value.entity.to_string(),
        view_definition_id: value.view_definition.as_str().into(),
        revision: value.revision.value().to_string(),
    }
}

pub(crate) fn observation(value: Observation) -> EntityViewPreference {
    match value {
        Observation::Saved(value) => {
            let value = saved(value);
            EntityViewPreference::Saved {
                entity_id: value.entity_id,
                view_definition_id: value.view_definition_id,
                revision: value.revision,
            }
        }
        Observation::Unset(entity) => EntityViewPreference::Unset {
            entity_id: entity.to_string(),
        },
        Observation::Missing(entity) => EntityViewPreference::Missing {
            entity_id: entity.to_string(),
        },
    }
}

pub(crate) fn failure(error: PreferenceError) -> DomainDiagnostic {
    let error = match error {
        PreferenceError::RevisionExhausted(entity) => PreferenceFailure::RevisionExhausted {
            entity_id: entity.to_string(),
        },
        PreferenceError::SchemaVersion(version) => PreferenceFailure::SchemaVersion {
            version: version.to_string(),
        },
        PreferenceError::CorruptSchema(message) => PreferenceFailure::CorruptSchema { message },
        PreferenceError::CorruptRecord { entity, message } => PreferenceFailure::CorruptRecord {
            entity_id: entity.to_string(),
            message,
        },
        PreferenceError::Store(error) => PreferenceFailure::Store {
            diagnostic: store::diagnostic(&error),
        },
        PreferenceError::Core(error) => PreferenceFailure::Core {
            error: core_failure(&error),
        },
        error => PreferenceFailure::InvalidInput {
            message: error.to_string(),
        },
    };
    DomainDiagnostic::Preferences { error }
}
