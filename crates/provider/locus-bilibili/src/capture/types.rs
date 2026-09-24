use serde::{Deserialize, Serialize};

/// Submitted provenance for one local asset; missing values remain unknown.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BilibiliSnapshot {
    pub bvid: Option<String>,
    pub aid: Option<String>,
    pub page_url: Option<String>,
    pub requested_url: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub uploader: Option<UploaderObservation>,
    pub published_at_unix_ms: Option<i64>,
    pub observed_at_unix_ms: Option<i64>,
    pub part: Option<PartObservation>,
    pub asset_role: Option<AssetRole>,
    pub capture_local_id: Option<String>,
    pub representation: Option<SelectedRepresentation>,
    pub preview: Option<RemotePreview>,
    pub issues: Option<Vec<CaptureIssue>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UploaderObservation {
    pub user_id: Option<String>,
    pub display_name: Option<String>,
    pub profile_url: Option<String>,
}

/// CID identifies the observed audiovisual part. Its one-based index is separate.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PartObservation {
    pub cid: Option<String>,
    pub index: Option<u32>,
    pub title: Option<String>,
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AssetRole {
    Video,
    Cover,
}

/// Source claims do not replace the File's intrinsic Media interpretation.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MediaClaims {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_ms: Option<u64>,
    pub mime_type: Option<String>,
    pub bitrate_bps: Option<u64>,
    pub quality: Option<String>,
    pub container: Option<String>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub audio_present: Option<bool>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SelectedRepresentation {
    pub url: Option<String>,
    /// Input resources for an assembled representation, not independent Files.
    pub source_urls: Option<Vec<String>>,
    pub assembled: Option<bool>,
    pub claims: Option<MediaClaims>,
}

/// The submission's remote cover is distinct from a local Video-generated cover.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RemotePreview {
    pub url: Option<String>,
    pub description: Option<String>,
    pub claims: Option<MediaClaims>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CapturePortion {
    Title,
    Description,
    Uploader,
    Part,
    PublicationTime,
    SelectedRepresentation,
    RemoteCover,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaptureIssue {
    pub portion: CapturePortion,
    pub code: String,
    pub message: Option<String>,
}
