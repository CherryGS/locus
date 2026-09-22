use crate::api::{core::dto::CoreFailure, error::Diagnostic, file::dto::CurrentInput};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Submitted observations, never independently verified remote facts.
/// `None` means not acquired; `Some("")` and `Some(vec![])` retain observed emptiness.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct TwitterSnapshot {
    pub post_id: Option<String>,
    pub page_url: Option<String>,
    /// The producer's requested URL, which need not be the subject post page.
    pub requested_url: Option<String>,
    pub text: Option<String>,
    pub author: Option<TwitterAuthorObservation>,
    /// Producer-reported post publication time, Unix milliseconds; never inferred.
    pub published_at_unix_ms: Option<String>,
    /// Producer's observation time, Unix milliseconds; not backend acceptance time.
    pub observed_at_unix_ms: Option<String>,
    pub hashtags: Option<Vec<String>>,
    pub references: Option<Vec<TwitterProviderReference>>,
    pub occurrence: Option<TwitterMediaOccurrence>,
    pub representation: Option<TwitterSelectedRepresentation>,
    pub preview: Option<TwitterRemotePreview>,
    pub issues: Option<Vec<TwitterCaptureIssue>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct TwitterAuthorObservation {
    pub user_id: Option<String>,
    pub handle: Option<String>,
    pub display_name: Option<String>,
    pub profile_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TwitterReferenceKind {
    ReplyTo,
    Quote,
    Repost,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct TwitterProviderReference {
    pub kind: TwitterReferenceKind,
    pub post_id: Option<String>,
    pub page_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TwitterMediaLabel {
    Photo,
    Video,
    AnimatedImage,
}

/// Claims remain scoped to the group containing them; no intrinsic facts are written.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct TwitterMediaClaims {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_ms: Option<String>,
    pub mime_type: Option<String>,
    pub bitrate_bps: Option<String>,
    pub quality: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct TwitterMediaOccurrence {
    pub media_id: Option<String>,
    /// Producer-local identifier, never promoted into a platform media ID.
    pub capture_local_id: Option<String>,
    /// Explicitly observed zero-based source order, never inferred from array position.
    pub source_order: Option<u32>,
    pub label: Option<TwitterMediaLabel>,
    pub alt_text: Option<String>,
    pub claims: Option<TwitterMediaClaims>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct TwitterSelectedRepresentation {
    pub url: Option<String>,
    pub claims: Option<TwitterMediaClaims>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct TwitterRemotePreview {
    pub url: Option<String>,
    pub description: Option<String>,
    pub claims: Option<TwitterMediaClaims>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TwitterCapturePortion {
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct TwitterCaptureIssue {
    pub portion: TwitterCapturePortion,
    pub code: String,
    pub message: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct TwitterRecord {
    pub component_id: String,
    pub kind_id: String,
    /// Exact decimal revision; not a JavaScript floating-point number.
    pub revision: String,
    pub basis: Option<String>,
    pub snapshot: TwitterSnapshot,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum TwitterComparison {
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
pub enum TwitterApplicability {
    Unmounted,
    Input {
        host: String,
        comparison: TwitterComparison,
        file_error: Option<Diagnostic>,
    },
    Error {
        error: TwitterFailure,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct TwitterView {
    pub record: TwitterRecord,
    pub applicability: TwitterApplicability,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum TwitterFailure {
    Core { error: CoreFailure },
    File { diagnostic: Diagnostic },
    Store { diagnostic: Diagnostic },
    MissingRecord { component_id: String },
    Corrupt { message: String },
    PayloadVersion { version: u32 },
    SchemaVersion { version: i32 },
    Other { message: String },
}
