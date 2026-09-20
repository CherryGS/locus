//! Server-level admission, request recovery, and cross-domain completion.
use super::{
    dto::*,
    error::{ApiError, ErrorCode},
    request::path_id,
};
use crate::runtime::Shared;
use axum::{
    Json,
    extract::{Path, State, rejection::PathRejection},
};
use std::sync::Arc;
#[utoipa::path(tag="server", get, path="/api/v1/server", responses((status=200, body=ServerStatus)))]
pub(super) async fn status(State(state): State<Arc<Shared>>) -> Json<ServerStatus> {
    Json(state.status())
}
#[utoipa::path(tag="server", get, path="/api/v1/requests/{request_id}", params(("request_id"=String, Path)), responses((status=200, body=Submission), (status=404, body=ApiError)))]
pub(super) async fn submission(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<Submission>, ApiError> {
    state.submission(&path_id(path)?).map(Json)
}
#[utoipa::path(tag="server", get, path="/api/v1/tasks/{task_id}/outcome", params(("task_id"=String, Path)), responses((status=200, body=OutcomeResponse), (status=404, body=ApiError)))]
pub(super) async fn outcome(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<OutcomeResponse>, ApiError> {
    state.outcome(&path_id(path)?).map(Json)
}
#[utoipa::path(tag="server", post, path="/api/v1/drain", responses((status=200, body=ServerStatus)))]
pub(super) async fn drain(State(state): State<Arc<Shared>>) -> Json<ServerStatus> {
    Json(state.close())
}
pub(super) async fn not_found() -> ApiError {
    ApiError::new(ErrorCode::NotFound, "Unknown API route")
}
pub(super) async fn method_not_allowed() -> ApiError {
    ApiError::new(ErrorCode::MethodNotAllowed, "Method not allowed")
}
pub(crate) fn router() -> utoipa_axum::router::OpenApiRouter<Arc<Shared>> {
    use utoipa_axum::{router::OpenApiRouter, routes};
    OpenApiRouter::new()
        .routes(routes!(status))
        .routes(routes!(submission))
        .routes(routes!(outcome))
        .routes(routes!(drain))
}
