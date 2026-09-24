use super::dto::*;
use crate::api::{
    bytes,
    core::mapping::entity,
    dto::{MutationOutcome, Receipt},
    error::ApiError,
    request::{body, canonical_id, path_id},
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
    http::{Method, StatusCode},
    response::Response,
};
use std::sync::Arc;
fn target(t: &MediaTarget) -> Result<locus_media::api::MediaId, ApiError> {
    let id = locus_core::api::ComponentId::from_bytes(canonical_id(&t.component_id)?.as_bytes())
        .map_err(|_| ApiError::invalid("component_id must be UUIDv7"))?;
    Ok(match t.kind {
        MediaKind::Image => locus_media::api::ImageId::from_component(id).into(),
        MediaKind::Video => locus_media::api::VideoId::from_component(id).into(),
    })
}
fn media_path(
    path: Result<Path<(MediaKind, String)>, PathRejection>,
) -> Result<locus_media::api::MediaId, ApiError> {
    let Path((kind, component_id)) =
        path.map_err(|_| ApiError::invalid("Expected image|video kind and component UUIDv7"))?;
    target(&MediaTarget { kind, component_id })
}
#[utoipa::path(tag="media", post,path="/api/v1/media",request_body=CreateMedia,responses((status=200,body=MutationOutcome)))]
pub(super) async fn create_media(
    State(state): State<Arc<Shared>>,
    input: Result<Json<CreateMedia>, JsonRejection>,
) -> Result<Json<MutationOutcome>, ApiError> {
    let request = body(input)?;
    canonical_id(&request.request_id)?;
    state.create_media(request).await.map(Json)
}
#[utoipa::path(tag="media", get,path="/api/v1/entities/{entity_id}/media",params(("entity_id"=String,Path)),responses((status=200,body=Vec<MediaEntry>)))]
pub(super) async fn entity_media(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<Vec<MediaEntry>>, ApiError> {
    state.entity_media(entity(&path_id(path)?)?).await.map(Json)
}
#[utoipa::path(tag="media", operation_id="read_media", get,path="/api/v1/media/{kind}/{component_id}",params(("kind"=MediaKind,Path),("component_id"=String,Path)),responses((status=200,body=MediaRecord)))]
pub(super) async fn read(
    State(state): State<Arc<Shared>>,
    path: Result<Path<(MediaKind, String)>, PathRejection>,
) -> Result<Json<MediaRecord>, ApiError> {
    state.media_read(media_path(path)?).await.map(Json)
}
#[utoipa::path(tag="media", operation_id="view_media", get,path="/api/v1/media/{kind}/{component_id}/view",params(("kind"=MediaKind,Path),("component_id"=String,Path)),responses((status=200,body=MediaView)))]
pub(super) async fn view(
    State(state): State<Arc<Shared>>,
    path: Result<Path<(MediaKind, String)>, PathRejection>,
) -> Result<Json<MediaView>, ApiError> {
    state.media_view(media_path(path)?).await.map(Json)
}
#[utoipa::path(tag="media",get,path="/api/v1/media/{kind}/{component_id}/saved-preview",params(("kind"=MediaKind,Path),("component_id"=String,Path)),responses((status=200,body=Option<PreviewMetadata>)))]
pub(super) async fn saved_preview(
    State(state): State<Arc<Shared>>,
    path: Result<Path<(MediaKind, String)>, PathRejection>,
) -> Result<Json<Option<PreviewMetadata>>, ApiError> {
    state.saved_preview(media_path(path)?).await.map(Json)
}
#[utoipa::path(tag="media", post,path="/api/v1/interpretations",request_body=InterpretRequest,responses((status=202,body=Receipt)))]
pub(super) async fn interpret(
    State(state): State<Arc<Shared>>,
    input: Result<Json<InterpretRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<Receipt>), ApiError> {
    let request = body(input)?;
    canonical_id(&request.request_id)?;
    let id = target(&request.target)?;
    Ok((StatusCode::ACCEPTED, Json(state.interpret(request, id)?)))
}
#[utoipa::path(tag="media", operation_id="generate_preview", post,path="/api/v1/previews",request_body=PreviewRequest,responses((status=202,body=Receipt)))]
pub(super) async fn preview(
    State(state): State<Arc<Shared>>,
    input: Result<Json<PreviewRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<Receipt>), ApiError> {
    let request = body(input)?;
    canonical_id(&request.request_id)?;
    let id = target(&request.target)?;
    Ok((StatusCode::ACCEPTED, Json(state.preview(request, id)?)))
}
#[utoipa::path(tag="media", operation_id="read_preview_bytes", get, path="/api/v1/previews/{locator}/bytes", params(("locator"=String,Path)),responses((status=200,body=String,content_type="image/png",description="Already-produced PNG. Run-scoped locator does not pin bytes and never regenerates. Range is ignored."),(status=404,body=ApiError)))]
pub(super) async fn preview_bytes(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
    method: Method,
) -> Result<Response, ApiError> {
    bytes::response(
        state.derived(path_id(path)?).await?,
        method == Method::HEAD,
        true,
    )
}
#[utoipa::path(tag="media", head, path="/api/v1/previews/{locator}/bytes", params(("locator"=String,Path)),responses((status=200,description="Same representation headers as GET; no body"),(status=404,body=ApiError)))]
pub(super) async fn preview_head(
    state: State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Response, ApiError> {
    preview_bytes(state, path, Method::HEAD).await
}
pub(crate) fn router() -> utoipa_axum::router::OpenApiRouter<Arc<Shared>> {
    use utoipa_axum::{router::OpenApiRouter, routes};
    OpenApiRouter::new()
        .routes(routes!(create_media))
        .routes(routes!(entity_media))
        .routes(routes!(read))
        .routes(routes!(view))
        .routes(routes!(saved_preview))
        .routes(routes!(interpret))
        .routes(routes!(preview))
        .routes(routes!(preview_bytes, preview_head))
}
