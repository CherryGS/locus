use crate::api::{core::dto::CoreFailure, error::Diagnostic, file::dto::CurrentInput};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Submitted provenance for one local asset; missing values remain unknown.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct BilibiliSnapshot {
    pub bvid: Option<String>,
    pub aid: Option<String>,
    pub page_url: Option<String>,
    pub requested_url: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub uploader: Option<BilibiliUploaderObservation>,
    pub published_at_unix_ms: Option<String>,
    pub observed_at_unix_ms: Option<String>,
    pub part: Option<BilibiliPartObservation>,
    pub asset_role: Option<BilibiliAssetRole>,
    pub capture_local_id: Option<String>,
    pub representation: Option<BilibiliSelectedRepresentation>,
    pub preview: Option<BilibiliRemotePreview>,
    pub issues: Option<Vec<BilibiliCaptureIssue>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct BilibiliUploaderObservation {
    pub user_id: Option<String>,
    pub display_name: Option<String>,
    pub profile_url: Option<String>,
}

/// CID identifies the observed audiovisual part. Its one-based index is separate.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct BilibiliPartObservation {
    pub cid: Option<String>,
    pub index: Option<u32>,
    pub title: Option<String>,
    pub duration_ms: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BilibiliAssetRole {
    Video,
    Cover,
}

/// Source claims do not replace the File's intrinsic Media interpretation.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct BilibiliMediaClaims {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_ms: Option<String>,
    pub mime_type: Option<String>,
    pub bitrate_bps: Option<String>,
    pub quality: Option<String>,
    pub container: Option<String>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub audio_present: Option<bool>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct BilibiliSelectedRepresentation {
    pub url: Option<String>,
    /// Input resources for an assembled representation, not independent Files.
    pub source_urls: Option<Vec<String>>,
    pub assembled: Option<bool>,
    pub claims: Option<BilibiliMediaClaims>,
}

/// The submission's remote cover is distinct from a local Video-generated cover.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct BilibiliRemotePreview {
    pub url: Option<String>,
    pub description: Option<String>,
    pub claims: Option<BilibiliMediaClaims>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BilibiliCapturePortion {
    Title,
    Description,
    Uploader,
    Part,
    PublicationTime,
    SelectedRepresentation,
    RemoteCover,
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
    SchemaVersion { version: i32 },
    Other { message: String },
}
