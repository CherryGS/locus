use super::dto::*;
use crate::api::{error::DomainDiagnostic, store};
use locus_settings::api as settings;
pub(crate) fn metadata(m: settings::Metadata) -> SettingsMetadata {
    SettingsMetadata {
        version: m.version.to_string(),
        revision: m.revision,
    }
}
pub(crate) fn saved(v: settings::SavedValue) -> SavedSettings {
    SavedSettings {
        group_id: v.group_id,
        metadata: metadata(v.metadata),
        value: v.value,
    }
}
pub(crate) fn observation(v: settings::Observation) -> SettingsObservation {
    use settings::Observation as O;
    match v {
        O::Corrupt {
            group_id,
            version,
            revision,
            message,
        } => SettingsObservation::Corrupt {
            group_id,
            version: version.map(|v| v.to_string()),
            revision,
            message,
        },
        O::Absent { group_id } => SettingsObservation::Absent { group_id },
        O::Current { saved: v } => SettingsObservation::Current { saved: saved(v) },
        O::Unavailable {
            group_id,
            metadata: m,
        } => SettingsObservation::Unavailable {
            group_id,
            metadata: m.map(metadata),
        },
        O::Invalid {
            group_id,
            metadata: m,
            message,
        } => SettingsObservation::Invalid {
            group_id,
            metadata: metadata(m),
            message,
        },
        O::Unsupported {
            group_id,
            metadata: m,
        } => SettingsObservation::Unsupported {
            group_id,
            metadata: metadata(m),
        },
    }
}
pub(crate) fn failure(e: settings::SettingsError) -> DomainDiagnostic {
    use settings::SettingsError as E;
    let error = match e {
        E::Store(e) => SettingsFailure::Store {
            diagnostic: store::diagnostic(&e),
        },
        E::Invalid(message) => SettingsFailure::Invalid { message },
        E::Unavailable(id) => SettingsFailure::Unavailable {
            group_id: id.to_string(),
        },
        e => SettingsFailure::Definition {
            message: e.to_string(),
        },
    };
    DomainDiagnostic::Settings { error }
}
