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
    extract::{
        Path, Query, State,
        rejection::{JsonRejection, PathRejection, QueryRejection},
    },
    http::StatusCode,
};
use std::sync::Arc;
fn id(value: &str) -> Result<locus_civitai::api::CivitaiId, ApiError> {
    locus_civitai::api::CivitaiId::from_bytes(canonical_id(value)?.as_bytes())
        .map_err(|_| ApiError::invalid("Civitai component must be UUIDv7"))
}
fn path(
    value: Result<Path<String>, PathRejection>,
) -> Result<locus_civitai::api::CivitaiId, ApiError> {
    id(&value
        .map_err(|_| ApiError::invalid("Invalid Civitai component path"))?
        .0)
}
#[utoipa::path(tag="civitai",get,path="/api/v1/civitai/{component_id}/view",params(("component_id"=String,Path)),responses((status=200,body=CivitaiView)))]
async fn view(
    State(s): State<Arc<Shared>>,
    p: Result<Path<String>, PathRejection>,
) -> Result<Json<CivitaiView>, ApiError> {
    s.civitai_view(path(p)?).await.map(Json)
}
#[utoipa::path(tag="civitai",get,path="/api/v1/civitai/{component_id}/page",params(("component_id"=String,Path)),responses((status=200,body=CivitaiPage)))]
async fn page(
    State(s): State<Arc<Shared>>,
    p: Result<Path<String>, PathRejection>,
) -> Result<Json<CivitaiPage>, ApiError> {
    s.civitai_page(path(p)?).await.map(Json)
}
#[derive(serde::Deserialize)]
struct VersionQuery {
    version: String,
    source: Option<String>,
}
#[utoipa::path(tag="civitai",get,path="/api/v1/civitai/{component_id}/version",params(("component_id"=String,Path),("version"=String,Query),("source"=Option<String>,Query)),responses((status=200,body=CivitaiVersionView)))]
async fn version(
    State(s): State<Arc<Shared>>,
    p: Result<Path<String>, PathRejection>,
    q: Result<Query<VersionQuery>, QueryRejection>,
) -> Result<Json<CivitaiVersionView>, ApiError> {
    let q = q
        .map_err(|_| ApiError::invalid("Expected version/source query"))?
        .0;
    let version = q
        .version
        .parse::<u64>()
        .map_err(|_| ApiError::invalid("Version must be an exact unsigned decimal identity"))?;
    if version.to_string() != q.version {
        return Err(ApiError::invalid("Version must be canonical decimal"));
    }
    s.civitai_version(path(p)?, version, q.source.as_deref().map(id).transpose()?)
        .await
        .map(Json)
}
#[utoipa::path(tag="civitai",get,path="/api/v1/civitai-operations",responses((status=200,body=CivitaiOperations)))]
async fn operations(State(s): State<Arc<Shared>>) -> Json<CivitaiOperations> {
    Json(s.civitai_operations())
}
#[utoipa::path(tag="civitai",post,path="/api/v1/civitai-operations",request_body=CivitaiRequest,responses((status=202,body=Receipt)))]
async fn enrich(
    State(s): State<Arc<Shared>>,
    r: Result<Json<CivitaiRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<Receipt>), ApiError> {
    let r = body(r)?;
    for value in [&r.request_id, &r.entity_id, &r.file_id] {
        canonical_id(value)?;
    }
    if let Some(c) = &r.continuation {
        canonical_id(c)?;
    }
    Ok((StatusCode::ACCEPTED, Json(s.enrich_civitai(r)?)))
}
pub(crate) fn router() -> utoipa_axum::router::OpenApiRouter<Arc<Shared>> {
    utoipa_axum::router::OpenApiRouter::new()
        .routes(utoipa_axum::routes!(view))
        .routes(utoipa_axum::routes!(page))
        .routes(utoipa_axum::routes!(version))
        .routes(utoipa_axum::routes!(operations, enrich))
}
