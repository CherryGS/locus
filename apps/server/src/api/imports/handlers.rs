use super::dto::*;
use crate::{
    api::{
        dto::Receipt,
        error::ApiError,
        request::{body, canonical_id},
    },
    runtime::Shared,
};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
};
use std::sync::Arc;
#[utoipa::path(tag="imports", post, path="/api/v1/registered-import-batches", request_body=RegisteredImportRequest, responses((status=202, body=crate::api::dto::Submission)))]
async fn registered(
    State(state): State<Arc<Shared>>,
    json: Result<Json<RegisteredImportRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<crate::api::dto::Submission>), ApiError> {
    let request = body(json)?;
    canonical_id(&request.request_id)?;
    Ok((
        StatusCode::ACCEPTED,
        Json(state.registered_import(request)?),
    ))
}
#[utoipa::path(tag="imports", post, path="/api/v1/import-batches", request_body=BatchImportRequest, responses((status=202, body=Receipt)))]
async fn submit(
    State(state): State<Arc<Shared>>,
    json: Result<Json<BatchImportRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<Receipt>), ApiError> {
    let request = body(json)?;
    canonical_id(&request.request_id)?;
    if request.source_paths.is_empty()
        || request
            .source_paths
            .iter()
            .any(|p| p.contains('\0') || !std::path::Path::new(p).is_absolute())
    {
        return Err(ApiError::invalid(
            "Select at least one absolute local file path",
        ));
    }
    Ok((StatusCode::ACCEPTED, Json(state.import_batch(request)?)))
}
#[utoipa::path(tag="imports", get, path="/api/v1/import-batches", responses((status=200, body=ImportSnapshot)))]
async fn observe(State(state): State<Arc<Shared>>) -> Json<ImportSnapshot> {
    Json(state.import_snapshot())
}
#[utoipa::path(tag="imports", post, path="/api/v1/import-recoveries", request_body=ImportRecoveryRequest, responses((status=202, body=Receipt)))]
async fn recover(
    State(state): State<Arc<Shared>>,
    json: Result<Json<ImportRecoveryRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<Receipt>), ApiError> {
    let request = body(json)?;
    for id in [&request.request_id, &request.batch_id, &request.item_id] {
        canonical_id(id)?;
    }
    Ok((StatusCode::ACCEPTED, Json(state.recover_import(request)?)))
}
pub(crate) fn router() -> utoipa_axum::router::OpenApiRouter<Arc<Shared>> {
    use utoipa_axum::{router::OpenApiRouter, routes};
    // Multi-file selection is bounded by actual request transport resources, not
    // the unrelated small-operation body limit or an invented file-count quota.
    OpenApiRouter::new()
        .routes(routes!(submit, observe))
        .routes(routes!(registered))
        .layer(axum::extract::DefaultBodyLimit::disable())
        .routes(routes!(recover))
}
