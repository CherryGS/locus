use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RequestIdentity {
    pub request_id: String,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MediaKind {
    Image,
    Video,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CreateMedia {
    pub request_id: String,
    pub kind: MediaKind,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Membership {
    pub entity_id: String,
    pub kind_id: String,
    pub component_id: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ChangeMembership {
    pub request_id: String,
    pub membership: Membership,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct MediaTarget {
    pub kind: MediaKind,
    pub component_id: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct InterpretRequest {
    pub request_id: String,
    pub target: MediaTarget,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PreviewRequest {
    pub request_id: String,
    pub target: MediaTarget,
    pub edge: u32,
}

/// Typed failures retain the owner boundary, including nested commit uncertainty.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(tag = "owner", rename_all = "snake_case")]
pub enum DomainDiagnostic {
    Core { error: CoreFailure },
    File { diagnostic: super::dto::Diagnostic },
    Media { error: MediaFailure },
    Store { diagnostic: super::dto::Diagnostic },
    Executor { message: String },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum CoreFailure {
    MissingEntity {
        entity_id: String,
    },
    MissingComponent {
        component_id: String,
    },
    SlotOccupied {
        component_id: String,
    },
    AttachmentOccupied {
        membership: Membership,
    },
    KindMismatch {
        component_id: String,
        actual: String,
        requested: String,
    },
    UnavailableKind {
        kind_id: String,
    },
    Store {
        diagnostic: super::dto::Diagnostic,
    },
    Other {
        message: String,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum MediaFailure {
    Core { error: CoreFailure },
    File { diagnostic: super::dto::Diagnostic },
    Store { diagnostic: super::dto::Diagnostic },
    MissingRecord { target: MediaTarget },
    Attempt { failure: AttemptFailure },
    Cache { message: String },
    PreviewAccess { diagnostic: super::dto::Diagnostic },
    Other { message: String },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AttemptCode {
    MissingInput,
    FileAccess,
    UnsupportedInput,
    Decode,
    Limit,
    Timeout,
    ToolUnavailable,
    ToolFailure,
    MalformedOutput,
    NoFrame,
    Worker,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct AttemptFailure {
    pub code: AttemptCode,
    pub detail: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum MutationOutcome {
    EntityCreated {
        entity_id: String,
    },
    MediaCreated {
        target: MediaTarget,
        kind_id: String,
    },
    Attached,
    AlreadyAttached,
    Detached {
        removed: bool,
    },
    Failed {
        diagnostic: DomainDiagnostic,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MediaFacts {
    Image {
        format: ImageFormat,
        width: u32,
        height: u32,
    },
    Video {
        container: String,
        stream_index: u32,
        codec: Option<String>,
        width: Option<u32>,
        height: Option<u32>,
        duration: Option<StreamDuration>,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ImageFormat {
    Png,
    Jpeg,
    WebP,
    Gif,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
pub struct StreamDuration {
    pub seconds: f64,
    pub precision: DurationPrecision,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DurationPrecision {
    Unknown,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
pub struct MediaRecord {
    pub target: MediaTarget,
    pub revision: String,
    pub basis: Option<String>,
    pub facts: Option<MediaFacts>,
    pub last_failure: Option<AttemptFailure>,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum CurrentInput {
    File { file_id: String },
    MissingEntity { entity_id: String },
    MissingSlot { entity_id: String },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Applicability {
    Unmounted,
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
    Error {
        diagnostic: DomainDiagnostic,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
pub struct MediaView {
    pub record: MediaRecord,
    pub applicability: Applicability,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum MediaEntryResult {
    Readable { view: MediaView },
    Failed { diagnostic: DomainDiagnostic },
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
pub struct MediaEntry {
    pub membership: Membership,
    pub result: MediaEntryResult,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Interpretation {
    Accepted { record: MediaRecord },
    RejectedContextChanged,
    RejectedNewerAttempt,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PreviewOrigin {
    Hit,
    Generated,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct PreviewMetadata {
    /// Run-scoped opaque locator; does not pin cache bytes. GET never regenerates.
    pub locator: String,
    pub file_id: String,
    pub kind: MediaKind,
    pub edge: u32,
    pub stream_index: Option<u32>,
    pub origin: PreviewOrigin,
}
