use super::dto::*;
use crate::api::{
    bytes,
    dto::Receipt,
    error::ApiError,
    request::{canonical_id, path_id},
};
use crate::runtime::Shared;
use axum::{
    Json,
    extract::{
        Path, State,
        rejection::{JsonRejection, PathRejection},
    },
};
use axum::{
    http::{HeaderMap, Method, StatusCode},
    response::Response,
};
use std::sync::Arc;
#[utoipa::path(tag="file", post, path="/api/v1/imports", request_body=ImportRequest, responses((status=202, body=Receipt)))]
pub(super) async fn import(
    State(state): State<Arc<Shared>>,
    body: Result<Json<ImportRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<Receipt>), ApiError> {
    let Json(request) =
        body.map_err(|_| ApiError::invalid("Expected a valid import JSON object"))?;
    canonical_id(&request.request_id)?;
    if request.source_path.len() > 8192
        || request.source_path.contains('\0')
        || !std::path::Path::new(&request.source_path).is_absolute()
    {
        return Err(ApiError::invalid(
            "source_path must be an absolute local path of at most 8192 UTF-8 bytes",
        ));
    }
    Ok((StatusCode::ACCEPTED, Json(state.import(request)?)))
}
#[utoipa::path(tag="file", get, path="/api/v1/files/{file_id}", params(("file_id"=String, Path)), responses((status=200, body=FileMetadata), (status=404, body=ApiError)))]
pub(super) async fn read(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<FileMetadata>, ApiError> {
    let id = path_id(path)?;
    let uuid = canonical_id(&id)?;
    let id = locus_file::api::FileId::from_bytes(uuid.as_bytes())
        .map_err(|_| ApiError::invalid("file_id must be a UUIDv7"))?;
    state.read(id).await.map(Json)
}
#[utoipa::path(tag="file", operation_id="read_original_bytes", get, path="/api/v1/files/{file_id}/bytes", params(("file_id"=String,Path),("Range"=Option<String>,Header,description="Single byte range; malformed/multiple ranges are ignored."),("If-Range"=Option<String>,Header,description="No validator is published; conditional ranges return the complete representation.")),responses((status=200,body=String,content_type="application/octet-stream",description="Complete original attachment; opened-file length."),(status=206,body=String,content_type="application/octet-stream",description="Single partial range with Content-Range and exact Content-Length."),(status=416,description="Unsatisfiable range; Content-Range bytes */length and empty body."),(status=404,body=ApiError)))]
pub(super) async fn original(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
    method: Method,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let id = path_id(path)?;
    let uuid = canonical_id(&id)?;
    let file = locus_file::api::FileId::from_bytes(uuid.as_bytes())
        .map_err(|_| ApiError::invalid("file_id must be UUIDv7"))?;
    bytes::original(
        state.original(file).await?,
        method == Method::HEAD,
        &headers,
    )
}
#[utoipa::path(tag="file", head, path="/api/v1/files/{file_id}/bytes", params(("file_id"=String,Path)),responses((status=200,description="Complete representation headers; Range is ignored and no body is sent."),(status=404,body=ApiError)))]
pub(super) async fn original_head(
    state: State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Response, ApiError> {
    original(state, path, Method::HEAD, HeaderMap::new()).await
}
pub(crate) fn router() -> utoipa_axum::router::OpenApiRouter<Arc<Shared>> {
    use utoipa_axum::{router::OpenApiRouter, routes};
    OpenApiRouter::new()
        .routes(routes!(import))
        .routes(routes!(read))
        .routes(routes!(original, original_head))
}
