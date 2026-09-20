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
};
use std::sync::Arc;
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
pub(crate) fn router() -> utoipa_axum::router::OpenApiRouter<Arc<Shared>> {
    use utoipa_axum::{router::OpenApiRouter, routes};
    OpenApiRouter::new()
        .routes(routes!(create_entity))
        .routes(routes!(attach))
        .routes(routes!(detach))
        .routes(routes!(memberships))
}
