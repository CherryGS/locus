use super::{
    dto::Receipt,
    error::ApiError,
    handlers::{canonical_id, path_id},
    media_dto::*,
};
use crate::runtime::Shared;
use axum::{
    Json,
    extract::{
        Path, State,
        rejection::{JsonRejection, PathRejection},
    },
    http::StatusCode,
};
use std::sync::Arc;
fn body<T>(value: Result<Json<T>, JsonRejection>) -> Result<T, ApiError> {
    value
        .map(|Json(v)| v)
        .map_err(|_| ApiError::invalid("Expected valid operation JSON"))
}
fn entity(id: &str) -> Result<locus_core::api::EntityId, ApiError> {
    locus_core::api::EntityId::from_bytes(canonical_id(id)?.as_bytes())
        .map_err(|_| ApiError::invalid("entity_id must be UUIDv7"))
}
fn target(t: &MediaTarget) -> Result<locus_media::api::MediaId, ApiError> {
    let id = locus_core::api::ComponentId::from_bytes(canonical_id(&t.component_id)?.as_bytes())
        .map_err(|_| ApiError::invalid("component_id must be UUIDv7"))?;
    Ok(match t.kind {
        MediaKind::Image => locus_media::api::ImageId::from_component(id).into(),
        MediaKind::Video => locus_media::api::VideoId::from_component(id).into(),
    })
}
fn membership(m: &Membership) -> Result<locus_core::api::Membership, ApiError> {
    Ok(locus_core::api::Membership {
        entity: entity(&m.entity_id)?,
        kind: locus_core::api::KindId::from_uuid(canonical_id(&m.kind_id)?),
        component: locus_core::api::ComponentId::from_bytes(
            canonical_id(&m.component_id)?.as_bytes(),
        )
        .map_err(|_| ApiError::invalid("component_id must be UUIDv7"))?,
    })
}
fn media_path(
    path: Result<Path<(MediaKind, String)>, PathRejection>,
) -> Result<locus_media::api::MediaId, ApiError> {
    let Path((kind, component_id)) =
        path.map_err(|_| ApiError::invalid("Expected image|video kind and component UUIDv7"))?;
    target(&MediaTarget { kind, component_id })
}

#[utoipa::path(post,path="/api/v1/entities",request_body=RequestIdentity,responses((status=200,body=MutationOutcome)))]
pub(super) async fn create_entity(
    State(state): State<Arc<Shared>>,
    input: Result<Json<RequestIdentity>, JsonRejection>,
) -> Result<Json<MutationOutcome>, ApiError> {
    let request = body(input)?;
    canonical_id(&request.request_id)?;
    state.create_entity(request.request_id).await.map(Json)
}
#[utoipa::path(post,path="/api/v1/media",request_body=CreateMedia,responses((status=200,body=MutationOutcome)))]
pub(super) async fn create_media(
    State(state): State<Arc<Shared>>,
    input: Result<Json<CreateMedia>, JsonRejection>,
) -> Result<Json<MutationOutcome>, ApiError> {
    let request = body(input)?;
    canonical_id(&request.request_id)?;
    state.create_media(request).await.map(Json)
}

#[utoipa::path(post,path="/api/v1/memberships/attach",request_body=ChangeMembership,responses((status=200,body=MutationOutcome)))]
pub(super) async fn attach(
    State(state): State<Arc<Shared>>,
    input: Result<Json<ChangeMembership>, JsonRejection>,
) -> Result<Json<MutationOutcome>, ApiError> {
    let request = body(input)?;
    canonical_id(&request.request_id)?;
    let m = membership(&request.membership)?;
    state.membership(request, m, true).await.map(Json)
}

#[utoipa::path(post,path="/api/v1/memberships/detach",request_body=ChangeMembership,responses((status=200,body=MutationOutcome)))]
pub(super) async fn detach(
    State(state): State<Arc<Shared>>,
    input: Result<Json<ChangeMembership>, JsonRejection>,
) -> Result<Json<MutationOutcome>, ApiError> {
    let request = body(input)?;
    canonical_id(&request.request_id)?;
    let m = membership(&request.membership)?;
    state.membership(request, m, false).await.map(Json)
}

#[utoipa::path(get,path="/api/v1/entities/{entity_id}/memberships",params(("entity_id"=String,Path)),responses((status=200,body=Vec<Membership>)))]
pub(super) async fn memberships(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<Vec<Membership>>, ApiError> {
    state.memberships(entity(&path_id(path)?)?).await.map(Json)
}

#[utoipa::path(get,path="/api/v1/entities/{entity_id}/media",params(("entity_id"=String,Path)),responses((status=200,body=Vec<MediaEntry>)))]
pub(super) async fn entity_media(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<Vec<MediaEntry>>, ApiError> {
    state.entity_media(entity(&path_id(path)?)?).await.map(Json)
}

#[utoipa::path(operation_id="read_media", get,path="/api/v1/media/{kind}/{component_id}",params(("kind"=MediaKind,Path),("component_id"=String,Path)),responses((status=200,body=MediaRecord)))]
pub(super) async fn read(
    State(state): State<Arc<Shared>>,
    path: Result<Path<(MediaKind, String)>, PathRejection>,
) -> Result<Json<MediaRecord>, ApiError> {
    state.media_read(media_path(path)?).await.map(Json)
}

#[utoipa::path(operation_id="view_media", get,path="/api/v1/media/{kind}/{component_id}/view",params(("kind"=MediaKind,Path),("component_id"=String,Path)),responses((status=200,body=MediaView)))]
pub(super) async fn view(
    State(state): State<Arc<Shared>>,
    path: Result<Path<(MediaKind, String)>, PathRejection>,
) -> Result<Json<MediaView>, ApiError> {
    state.media_view(media_path(path)?).await.map(Json)
}

#[utoipa::path(post,path="/api/v1/interpretations",request_body=InterpretRequest,responses((status=202,body=Receipt)))]
pub(super) async fn interpret(
    State(state): State<Arc<Shared>>,
    input: Result<Json<InterpretRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<Receipt>), ApiError> {
    let request = body(input)?;
    canonical_id(&request.request_id)?;
    let id = target(&request.target)?;
    Ok((StatusCode::ACCEPTED, Json(state.interpret(request, id)?)))
}

#[utoipa::path(operation_id="generate_preview", post,path="/api/v1/previews",request_body=PreviewRequest,responses((status=202,body=Receipt)))]
pub(super) async fn preview(
    State(state): State<Arc<Shared>>,
    input: Result<Json<PreviewRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<Receipt>), ApiError> {
    let request = body(input)?;
    canonical_id(&request.request_id)?;
    let id = target(&request.target)?;
    Ok((StatusCode::ACCEPTED, Json(state.preview(request, id)?)))
}
