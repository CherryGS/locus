use super::{
    core::dto::CoreFailure, media::dto::MediaFailure, preferences::dto::PreferenceFailure,
};
use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    Unauthorized,
    ForeignOrigin,
    WrongRun,
    InvalidRequest,
    RequestConflict,
    AdmissionClosed,
    LaunchRejected,
    UnknownRequest,
    UnknownTask,
    MissingFile,
    MissingBytes,
    AccessDenied,
    PreviewUnavailable,
    OperationFailed,
    NotFound,
    MethodNotAllowed,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct ApiError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<DomainDiagnostic>,
}

impl ApiError {
    pub(crate) fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            diagnostic: None,
        }
    }
    pub(crate) fn domain(diagnostic: DomainDiagnostic) -> Self {
        Self {
            code: ErrorCode::OperationFailed,
            message: "Domain operation failed".into(),
            diagnostic: Some(diagnostic),
        }
    }
    pub(crate) fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidRequest, message)
    }
    pub(crate) fn status(&self) -> StatusCode {
        match self.code {
            ErrorCode::Unauthorized => StatusCode::UNAUTHORIZED,
            ErrorCode::ForeignOrigin | ErrorCode::AccessDenied => StatusCode::FORBIDDEN,
            ErrorCode::WrongRun | ErrorCode::RequestConflict => StatusCode::CONFLICT,
            ErrorCode::InvalidRequest => StatusCode::BAD_REQUEST,
            ErrorCode::AdmissionClosed | ErrorCode::LaunchRejected => {
                StatusCode::SERVICE_UNAVAILABLE
            }
            ErrorCode::UnknownRequest
            | ErrorCode::UnknownTask
            | ErrorCode::MissingBytes
            | ErrorCode::PreviewUnavailable
            | ErrorCode::MissingFile
            | ErrorCode::NotFound => StatusCode::NOT_FOUND,
            ErrorCode::OperationFailed => StatusCode::INTERNAL_SERVER_ERROR,
            ErrorCode::MethodNotAllowed => StatusCode::METHOD_NOT_ALLOWED,
        }
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status(), Json(self)).into_response()
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FailureKind {
    InputMissing,
    ManagedBytesMissing,
    AccessDenied,
    NotRegularFile,
    Io,
    CommitOutcomeUnknown,
    Database,
    Domain,
    Executor,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
pub struct Diagnostic {
    pub kind: FailureKind,
    pub message: String,
}
/// Typed failures retain the owner boundary, including nested commit uncertainty.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(tag = "owner", rename_all = "snake_case")]
pub enum DomainDiagnostic {
    Settings {
        error: super::settings::dto::SettingsFailure,
    },
    Core {
        error: CoreFailure,
    },
    File {
        diagnostic: Diagnostic,
    },
    Media {
        error: MediaFailure,
    },
    Twitter {
        error: super::twitter::dto::TwitterFailure,
    },
    Preferences {
        error: PreferenceFailure,
    },
    Store {
        diagnostic: Diagnostic,
    },
    Executor {
        message: String,
    },
}
