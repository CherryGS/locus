use super::dto::BilibiliView;
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
#[utoipa::path(tag="bilibili", operation_id="view_bilibili", get,path="/api/v1/bilibili/{component_id}/view",params(("component_id"=String,Path)),responses((status=200,body=BilibiliView)))]
async fn view(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<BilibiliView>, ApiError> {
    let id = locus_core::api::ComponentId::from_bytes(canonical_id(&path_id(path)?)?.as_bytes())
        .map_err(|_| ApiError::invalid("component_id must be UUIDv7"))?;
    state
        .bilibili_view(locus_bilibili::api::BilibiliId::from_component(id))
        .await
        .map(Json)
}
pub(crate) fn router() -> utoipa_axum::router::OpenApiRouter<Arc<Shared>> {
    utoipa_axum::router::OpenApiRouter::new().routes(utoipa_axum::routes!(view))
}
