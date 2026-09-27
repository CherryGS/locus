use crate::api::{core::dto::CoreFailure, error::Diagnostic, file::dto::CurrentInput};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Submitted values, not verified remote facts. None means not acquired;
/// Some("") and Some(vec![]) preserve observed emptiness.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct BilibiliSnapshot {
    pub bvid: Option<String>,
    pub aid: Option<String>,
    pub page_url: Option<String>,
    pub requested_url: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub author: Option<BilibiliAuthorObservation>,
    pub published_at_unix_ms: Option<String>,
    pub observed_at_unix_ms: Option<String>,
    pub tags: Option<Vec<String>>,
    pub part: Option<BilibiliPartObservation>,
    pub representation: Option<BilibiliSelectedRepresentation>,
    pub preview: Option<BilibiliRemotePreview>,
    pub issues: Option<Vec<BilibiliCaptureIssue>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct BilibiliAuthorObservation {
    pub user_id: Option<String>,
    pub display_name: Option<String>,
    pub profile_url: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct BilibiliPartObservation {
    pub cid: Option<String>,
    /// Observed one-based part number; no missing part is inferred.
    pub number: Option<u32>,
    pub title: Option<String>,
    pub claims: Option<BilibiliMediaClaims>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct BilibiliMediaClaims {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_ms: Option<String>,
    pub mime_type: Option<String>,
    pub bitrate_bps: Option<String>,
    pub quality: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct BilibiliSelectedRepresentation {
    pub url: Option<String>,
    pub claims: Option<BilibiliMediaClaims>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct BilibiliRemotePreview {
    pub url: Option<String>,
    pub description: Option<String>,
    pub claims: Option<BilibiliMediaClaims>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub enum BilibiliCapturePortion {
    Submission,
    Author,
    PublicationTime,
    Tags,
    Part,
    SelectedRepresentation,
    RemotePreview,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct BilibiliCaptureIssue {
    pub portion: BilibiliCapturePortion,
    pub code: String,
    pub message: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct BilibiliRecord {
    pub component_id: String,
    pub kind_id: String,
    /// Exact decimal revision; not a JavaScript floating-point number.
    pub revision: String,
    pub basis: Option<String>,
    pub snapshot: BilibiliSnapshot,
    pub original_cover: Option<BilibiliOriginalCover>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum BilibiliComparison {
    Matching {
        file_id: String,
    },
    Changed {
        basis: String,
        current: String,
    },
    Incomplete {
        basis: Option<String>,
        current: CurrentInput,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum BilibiliApplicability {
    Unmounted,
    Input {
        host: String,
        comparison: BilibiliComparison,
        file_error: Option<Diagnostic>,
    },
    Error {
        error: BilibiliFailure,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct BilibiliView {
    pub record: BilibiliRecord,
    pub applicability: BilibiliApplicability,
    pub cover: BilibiliCoverApplicability,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum BilibiliFailure {
    Core { error: CoreFailure },
    File { diagnostic: Diagnostic },
    Store { diagnostic: Diagnostic },
    MissingRecord { component_id: String },
    Corrupt { message: String },
    PayloadVersion { version: u32 },
    Other { message: String },
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct BilibiliOriginalCover {
    pub entity_id: String,
    pub file_id: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum BilibiliCoverApplicability {
    Unassociated,
    Input {
        comparison: BilibiliComparison,
        file_error: Option<Diagnostic>,
    },
    Error {
        diagnostic: Diagnostic,
    },
}
