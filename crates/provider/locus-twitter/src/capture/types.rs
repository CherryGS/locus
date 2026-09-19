use serde::{Deserialize, Serialize};

/// Submitted observations, never independently verified remote facts.
/// `None` means not acquired; `Some("")` and `Some(vec![])` retain observed emptiness.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TwitterSnapshot {
    pub post_id: Option<String>,
    pub page_url: Option<String>,
    /// The producer's requested URL, which need not be the subject post page.
    pub requested_url: Option<String>,
    pub text: Option<String>,
    pub author: Option<AuthorObservation>,
    /// Producer-reported post publication time, Unix milliseconds; never inferred.
    pub published_at_unix_ms: Option<i64>,
    /// Producer's observation time, Unix milliseconds; not backend acceptance time.
    pub observed_at_unix_ms: Option<i64>,
    pub hashtags: Option<Vec<String>>,
    pub references: Option<Vec<ProviderReference>>,
    pub occurrence: Option<MediaOccurrence>,
    pub representation: Option<SelectedRepresentation>,
    pub preview: Option<RemotePreview>,
    pub issues: Option<Vec<CaptureIssue>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorObservation {
    pub user_id: Option<String>,
    pub handle: Option<String>,
    pub display_name: Option<String>,
    pub profile_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReferenceKind {
    ReplyTo,
    Quote,
    Repost,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderReference {
    pub kind: ReferenceKind,
    pub post_id: Option<String>,
    pub page_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MediaLabel {
    Photo,
    Video,
    AnimatedImage,
}

/// Claims remain scoped to the group containing them; no intrinsic facts are written.
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
pub struct MediaOccurrence {
    pub media_id: Option<String>,
    /// Producer-local identifier, never promoted into a platform media ID.
    pub capture_local_id: Option<String>,
    /// Explicitly observed zero-based source order, never inferred from array position.
    pub source_order: Option<u32>,
    pub label: Option<MediaLabel>,
    pub alt_text: Option<String>,
    pub claims: Option<MediaClaims>,
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
    PostText,
    Author,
    PublicationTime,
    Hashtags,
    References,
    MediaOccurrence,
    SelectedRepresentation,
    RemotePreview,
}

/// A producer-reported failure/unavailability, not a backend diagnosis.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaptureIssue {
    pub portion: CapturePortion,
    pub code: String,
    pub message: Option<String>,
}
