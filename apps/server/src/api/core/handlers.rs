use super::{
    dto::*,
    mapping::{entity, membership_input},
};
use crate::api::{
    dto::{MutationOutcome, RequestIdentity},
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
    http::header,
    response::{IntoResponse, Response},
};
use std::sync::Arc;
#[utoipa::path(tag="core", get,path="/api/v1/entities",responses((status=200,description="Complete packed RFC UUIDv7 identities, 16 bytes each; unspecified sequence order. DB work completes before transfer. Empty success is zero bytes.",body=Vec<u8>,content_type="application/octet-stream",headers(("Content-Length"=String,description="Exact decimal byte count, required even for empty success"),("X-Content-Type-Options"=String,description="nosniff"),("Cache-Control"=String,description="no-store")))))]
pub(super) async fn entity_ids(State(state): State<Arc<Shared>>) -> Result<Response, ApiError> {
    let bytes = state.entity_ids().await?;
    Ok((
        [
            (header::CONTENT_TYPE, "application/octet-stream".to_owned()),
            (header::CONTENT_LENGTH, bytes.len().to_string()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_owned()),
            (header::CACHE_CONTROL, "no-store".to_owned()),
        ],
        bytes,
    )
        .into_response())
}

#[utoipa::path(tag="core", post,path="/api/v1/memberships/read",request_body=ReadMemberships,responses((status=200,description="One attributed result per input position, including duplicates. Database/decode failure rejects the whole batch.",body=Vec<EntityMemberships>)))]
pub(super) async fn memberships_batch(
    State(state): State<Arc<Shared>>,
    input: Result<Json<ReadMemberships>, JsonRejection>,
) -> Result<Json<Vec<EntityMemberships>>, ApiError> {
    let input = body(input)?;
    let entities = input
        .entity_ids
        .iter()
        .map(|id| entity(id))
        .collect::<Result<Vec<_>, _>>()?;
    state.memberships_batch(entities).await.map(Json)
}
#[utoipa::path(tag="core", post,path="/api/v1/entities",request_body=RequestIdentity,responses((status=200,body=MutationOutcome)))]
pub(super) async fn create_entity(
    State(state): State<Arc<Shared>>,
    input: Result<Json<RequestIdentity>, JsonRejection>,
) -> Result<Json<MutationOutcome>, ApiError> {
    let request = body(input)?;
    canonical_id(&request.request_id)?;
    state.create_entity(request.request_id).await.map(Json)
}
#[utoipa::path(tag="core", post,path="/api/v1/memberships/attach",request_body=ChangeMembership,responses((status=200,body=MutationOutcome)))]
pub(super) async fn attach(
    State(state): State<Arc<Shared>>,
    input: Result<Json<ChangeMembership>, JsonRejection>,
) -> Result<Json<MutationOutcome>, ApiError> {
    let request = body(input)?;
    canonical_id(&request.request_id)?;
    let m = membership_input(&request.membership)?;
    state.membership(request, m, true).await.map(Json)
}
#[utoipa::path(tag="core", post,path="/api/v1/memberships/detach",request_body=ChangeMembership,responses((status=200,body=MutationOutcome)))]
pub(super) async fn detach(
    State(state): State<Arc<Shared>>,
    input: Result<Json<ChangeMembership>, JsonRejection>,
) -> Result<Json<MutationOutcome>, ApiError> {
    let request = body(input)?;
    canonical_id(&request.request_id)?;
    let m = membership_input(&request.membership)?;
    state.membership(request, m, false).await.map(Json)
}
#[utoipa::path(tag="core", get,path="/api/v1/entities/{entity_id}/memberships",params(("entity_id"=String,Path)),responses((status=200,body=Vec<Membership>)))]
pub(super) async fn memberships(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<Vec<Membership>>, ApiError> {
    state.memberships(entity(&path_id(path)?)?).await.map(Json)
}
#[utoipa::path(tag="core", get,path="/api/v1/entities/{entity_id}/notes",params(("entity_id"=String,Path)),responses((status=200,body=EntityNotes)))]
pub(super) async fn notes(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<EntityNotes>, ApiError> {
    state.entity_notes(entity(&path_id(path)?)?).await.map(Json)
}

#[utoipa::path(tag="core", put,path="/api/v1/entities/{entity_id}/notes",params(("entity_id"=String,Path)),request_body=WriteEntityNotes,responses((status=200,body=MutationOutcome)))]
pub(super) async fn write_notes(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
    input: Result<Json<WriteEntityNotes>, JsonRejection>,
) -> Result<Json<MutationOutcome>, ApiError> {
    let request = body(input)?;
    canonical_id(&request.request_id)?;
    state
        .write_entity_notes(entity(&path_id(path)?)?, request)
        .await
        .map(Json)
}

pub(crate) fn router() -> utoipa_axum::router::OpenApiRouter<Arc<Shared>> {
    use utoipa_axum::{
        router::{OpenApiRouter, UtoipaMethodRouterExt},
        routes,
    };
    OpenApiRouter::new()
        .routes(routes!(create_entity, entity_ids))
        // This read accepts the caller-selected subset without the generic JSON
        // ceiling imposing an accidental item quota. Other routes retain it.
        .routes(routes!(memberships_batch).layer(axum::extract::DefaultBodyLimit::disable()))
        .routes(routes!(attach))
        .routes(routes!(detach))
        .routes(routes!(memberships))
        .routes(routes!(notes, write_notes).layer(axum::extract::DefaultBodyLimit::disable()))
}
