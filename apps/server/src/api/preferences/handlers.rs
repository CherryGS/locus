use super::{dto::*, mapping};
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

#[utoipa::path(tag="preferences", get, path="/api/v1/entities/{entity_id}/view-preference", params(("entity_id"=String,Path)), responses((status=200,body=EntityViewPreference)))]
pub(super) async fn read_view_preference(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<EntityViewPreference>, ApiError> {
    state
        .view_preference(entity(&path_id(path)?)?)
        .await
        .map(Json)
}

#[utoipa::path(tag="preferences", post, path="/api/v1/entities/view-preferences/batch", request_body=ReadViewPreferences, responses((status=200,description="One attributed result per input position. Database/decode failure rejects the whole batch.",body=Vec<EntityViewPreference>)))]
pub(super) async fn read_view_preferences(
    State(state): State<Arc<Shared>>,
    input: Result<Json<ReadViewPreferences>, JsonRejection>,
) -> Result<Json<Vec<EntityViewPreference>>, ApiError> {
    let input = body(input)?;
    let entities = input
        .entity_ids
        .iter()
        .map(|id| entity(id))
        .collect::<Result<Vec<_>, _>>()?;
    state.view_preferences(entities).await.map(Json)
}

#[utoipa::path(tag="preferences", put, path="/api/v1/entities/{entity_id}/view-preference", params(("entity_id"=String,Path)), request_body=UpdateViewPreference, responses((status=200,description="Saved only after commit succeeds. Conflict returns the observed current preference without retry. Recover lost completion by the same request ID in this run.",body=MutationOutcome)))]
pub(super) async fn update_view_preference(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
    input: Result<Json<UpdateViewPreference>, JsonRejection>,
) -> Result<Json<MutationOutcome>, ApiError> {
    let entity = entity(&path_id(path)?)?;
    let input = body(input)?;
    canonical_id(&input.request_id)?;
    let (view, revision) =
        mapping::input(input.view_definition_id, input.expected_revision.as_deref())?;
    state
        .update_view_preference(input.request_id, entity, view, revision)
        .await
        .map(Json)
}

pub(crate) fn router() -> utoipa_axum::router::OpenApiRouter<Arc<Shared>> {
    use utoipa_axum::{
        router::{OpenApiRouter, UtoipaMethodRouterExt},
        routes,
    };
    OpenApiRouter::new()
        .merge(super::card_cover_handlers::router())
        .routes(routes!(read_view_preference, update_view_preference))
        // As with membership batches, only the caller-selected identities are read;
        // the generic JSON limit must not impose an accidental item quota.
        .routes(routes!(read_view_preferences).layer(axum::extract::DefaultBodyLimit::disable()))
}
