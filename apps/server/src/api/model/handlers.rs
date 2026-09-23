use super::dto::{ModelRecord, ModelView};
use crate::{
    api::{
        error::ApiError,
        request::{canonical_id, path_id},
    },
    runtime::Shared,
};
use axum::{
    Json,
    extract::{Path, State, rejection::PathRejection},
};
use std::sync::Arc;
fn id(path: Result<Path<String>, PathRejection>) -> Result<locus_model::api::ModelId, ApiError> {
    locus_model::api::ModelId::from_bytes(canonical_id(&path_id(path)?)?.as_bytes())
        .map_err(|_| ApiError::invalid("component_id must be UUIDv7"))
}
#[utoipa::path(tag="model",operation_id="read_model",get,path="/api/v1/models/{component_id}",params(("component_id"=String,Path)),responses((status=200,body=ModelRecord)))]
async fn read(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<ModelRecord>, ApiError> {
    state.model_read(id(path)?).await.map(Json)
}
#[utoipa::path(tag="model",operation_id="view_model",get,path="/api/v1/models/{component_id}/view",params(("component_id"=String,Path)),responses((status=200,body=ModelView)))]
async fn view(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<ModelView>, ApiError> {
    state.model_view(id(path)?).await.map(Json)
}
pub(crate) fn router() -> utoipa_axum::router::OpenApiRouter<Arc<Shared>> {
    use utoipa_axum::{router::OpenApiRouter, routes};
    OpenApiRouter::new()
        .routes(routes!(read))
        .routes(routes!(view))
}
