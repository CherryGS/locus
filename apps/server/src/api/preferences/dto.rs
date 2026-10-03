use crate::api::{core::dto::CoreFailure, error::Diagnostic};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct UpdateViewPreference {
    pub request_id: String,
    /// Opaque retained definition identity; unavailable definitions remain valid.
    pub view_definition_id: String,
    /// Canonical positive decimal through 9223372036854775807. Null or omitted
    /// requires no saved preference; it never means unconditional overwrite.
    pub expected_revision: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReadViewPreferences {
    /// Caller-selected identities, with one ordered result per input including duplicates.
    pub entity_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct SavedViewPreference {
    pub entity_id: String,
    pub view_definition_id: String,
    /// Canonical positive decimal, retained as a string to preserve integer precision.
    pub revision: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum EntityViewPreference {
    Saved {
        entity_id: String,
        view_definition_id: String,
        revision: String,
    },
    Unset {
        entity_id: String,
    },
    Missing {
        entity_id: String,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum PreferenceFailure {
    RevisionExhausted { entity_id: String },
    CorruptRecord { entity_id: String, message: String },
    Store { diagnostic: Diagnostic },
    Core { error: CoreFailure },
    InvalidInput { message: String },
}

/// A retained managed-image choice, qualified again by the renderer before use.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CardCoverSelection {
    pub source_component_id: String,
    pub version_id: String,
    pub target_entity_id: String,
    pub target_file_id: String,
    pub image_component_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct UpdateCardCoverPreference {
    pub request_id: String,
    /// Null explicitly clears the selection while retaining its write revision.
    #[serde(deserialize_with = "Option::deserialize")]
    #[schema(required = true)]
    pub cover: Option<CardCoverSelection>,
    /// Null or omitted requires no saved preference, never unconditional overwrite.
    pub expected_revision: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReadCardCoverPreferences {
    pub entity_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct SavedCardCoverPreference {
    pub entity_id: String,
    #[schema(required = true)]
    pub cover: Option<CardCoverSelection>,
    pub revision: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum EntityCardCoverPreference {
    Saved {
        entity_id: String,
        #[schema(required = true)]
        cover: Option<CardCoverSelection>,
        revision: String,
    },
    Unset {
        entity_id: String,
    },
    Missing {
        entity_id: String,
    },
}
