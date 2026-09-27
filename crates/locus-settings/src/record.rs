use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Definition {
    pub group_id: String,
    pub name: String,
    pub version: u32,
    pub schema: Value,
    pub defaults: Value,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Metadata {
    pub version: i64,
    /// Opaque, freshly assigned UUID on every accepted write; never reset/reused.
    pub revision: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct SavedValue {
    pub group_id: String,
    pub metadata: Metadata,
    pub value: Value,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Observation {
    Corrupt {
        group_id: String,
        version: Option<i64>,
        revision: Option<String>,
        message: String,
    },
    Absent {
        group_id: String,
    },
    Current {
        saved: SavedValue,
    },
    Unavailable {
        group_id: String,
        metadata: Option<Metadata>,
    },
    Invalid {
        group_id: String,
        metadata: Metadata,
        message: String,
    },
    Unsupported {
        group_id: String,
        metadata: Metadata,
    },
}
#[derive(Clone, Debug, PartialEq)]
pub enum WriteOutcome {
    Saved(SavedValue),
    Existing(Observation),
    Conflict(Observation),
}
