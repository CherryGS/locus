use super::{card_cover_mapping, dto::*};
use crate::{
    api::{
        core::mapping::entity,
        dto::MutationOutcome,
        error::ApiError,
        request::{body, canonical_id, path_id},
    },
    runtime::Shared,
};
use axum::{
    Json,
    extract::{
        Path, State,
        rejection::{JsonRejection, PathRejection},
    },
};
use std::sync::Arc;

#[utoipa::path(tag="preferences", get, path="/api/v1/entities/{entity_id}/card-cover-preference", params(("entity_id"=String,Path)), responses((status=200,body=EntityCardCoverPreference)))]
async fn read_card_cover_preference(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<EntityCardCoverPreference>, ApiError> {
    state
        .card_cover_preference(entity(&path_id(path)?)?)
        .await
        .map(Json)
}

#[utoipa::path(tag="preferences", post, path="/api/v1/entities/card-cover-preferences/batch", request_body=ReadCardCoverPreferences, responses((status=200,description="One attributed result per input including duplicates. Observation failure rejects the whole batch.",body=Vec<EntityCardCoverPreference>)))]
async fn read_card_cover_preferences(
    State(state): State<Arc<Shared>>,
    input: Result<Json<ReadCardCoverPreferences>, JsonRejection>,
) -> Result<Json<Vec<EntityCardCoverPreference>>, ApiError> {
    let input = body(input)?;
    let entities = input
        .entity_ids
        .iter()
        .map(|id| entity(id))
        .collect::<Result<Vec<_>, _>>()?;
    state.card_cover_preferences(entities).await.map(Json)
}

#[utoipa::path(tag="preferences", put, path="/api/v1/entities/{entity_id}/card-cover-preference", params(("entity_id"=String,Path)), request_body=UpdateCardCoverPreference, responses((status=200,description="Conditional recoverable save or clear; commits UI intent only, without claiming a provider relationship or preview availability.",body=MutationOutcome)))]
async fn update_card_cover_preference(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
    input: Result<Json<UpdateCardCoverPreference>, JsonRejection>,
) -> Result<Json<MutationOutcome>, ApiError> {
    let entity = entity(&path_id(path)?)?;
    let input = body(input)?;
    canonical_id(&input.request_id)?;
    let (cover, revision) =
        card_cover_mapping::input(input.cover, input.expected_revision.as_deref())?;
    state
        .update_card_cover_preference(input.request_id, entity, cover, revision)
        .await
        .map(Json)
}

pub(super) fn router() -> utoipa_axum::router::OpenApiRouter<Arc<Shared>> {
    use utoipa_axum::{
        router::{OpenApiRouter, UtoipaMethodRouterExt},
        routes,
    };
    OpenApiRouter::new()
        .routes(routes!(
            read_card_cover_preference,
            update_card_cover_preference
        ))
        .routes(
            routes!(read_card_cover_preferences).layer(axum::extract::DefaultBodyLimit::disable()),
        )
}
