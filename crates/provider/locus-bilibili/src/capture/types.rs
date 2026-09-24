use serde::{Deserialize, Serialize};

/// Submitted values, not verified remote facts. None means not acquired;
/// Some("") and Some(vec![]) preserve observed emptiness.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BilibiliSnapshot {
    pub bvid: Option<String>,
    pub aid: Option<String>,
    pub page_url: Option<String>,
    pub requested_url: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub author: Option<AuthorObservation>,
    pub published_at_unix_ms: Option<i64>,
    pub observed_at_unix_ms: Option<i64>,
    pub tags: Option<Vec<String>>,
    pub part: Option<PartObservation>,
    pub representation: Option<SelectedRepresentation>,
    pub preview: Option<RemotePreview>,
    pub issues: Option<Vec<CaptureIssue>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorObservation {
    pub user_id: Option<String>,
    pub display_name: Option<String>,
    pub profile_url: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PartObservation {
    pub cid: Option<String>,
    /// Observed one-based part number; no missing part is inferred.
    pub number: Option<u32>,
    pub title: Option<String>,
    pub claims: Option<MediaClaims>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MediaClaims {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_ms: Option<u64>,
    pub mime_type: Option<String>,
    pub bitrate_bps: Option<u64>,
    pub quality: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SelectedRepresentation {
    pub url: Option<String>,
    pub claims: Option<MediaClaims>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RemotePreview {
    pub url: Option<String>,
    pub description: Option<String>,
    pub claims: Option<MediaClaims>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CapturePortion {
    Submission,
    Author,
    PublicationTime,
    Tags,
    Part,
    SelectedRepresentation,
    RemotePreview,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaptureIssue {
    pub portion: CapturePortion,
    pub code: String,
    pub message: Option<String>,
}
