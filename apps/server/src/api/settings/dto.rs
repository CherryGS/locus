use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
pub struct SettingsDefinition {
    pub group_id: String,
    pub name: String,
    pub version: u32,
    pub schema: Value,
    pub defaults: Value,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct SettingsMetadata {
    pub version: String,
    pub revision: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
pub struct SavedSettings {
    pub group_id: String,
    pub metadata: SettingsMetadata,
    pub value: Value,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SettingsObservation {
    Corrupt {
        group_id: String,
        version: Option<String>,
        revision: Option<String>,
        message: String,
    },
    Absent {
        group_id: String,
    },
    Current {
        saved: SavedSettings,
    },
    ConversionRequired {
        group_id: String,
        metadata: SettingsMetadata,
        source: String,
    },
    Unavailable {
        group_id: String,
        metadata: Option<SettingsMetadata>,
    },
    Invalid {
        group_id: String,
        metadata: SettingsMetadata,
        message: String,
    },
    Unsupported {
        group_id: String,
        metadata: SettingsMetadata,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub enum SettingsChange {
    Initialize,
    Update {
        expected_revision: String,
        value: Value,
    },
    Reset {
        expected_revision: String,
    },
    Convert {
        metadata: SettingsMetadata,
        source: String,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ChangeSettings {
    pub request_id: String,
    pub change: SettingsChange,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum SettingsFailure {
    Store {
        diagnostic: crate::api::error::Diagnostic,
    },
    Invalid {
        message: String,
    },
    Unavailable {
        group_id: String,
    },
    Unsupported {
        version: String,
    },
    Definition {
        message: String,
    },
    Schema {
        message: String,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct EffectiveToolPath {
    pub path: String,
    /// Present only when this process explicitly overrides the captured setting.
    pub environment: Option<String>,
}
/// Captured is the saved startup value; changes to saved values do not reconfigure
/// this run. Effective paths also include explicit process environment overrides.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
pub struct MediaSettingsRuntime {
    pub captured: SavedSettings,
    pub ffprobe: EffectiveToolPath,
    pub ffmpeg: EffectiveToolPath,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum MediaRuntimeObservation {
    Active { runtime: MediaSettingsRuntime },
    Unavailable,
}
