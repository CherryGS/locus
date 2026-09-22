use super::dto::*;
use crate::{
    api::{
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
fn group(path: Result<Path<String>, PathRejection>) -> Result<uuid::Uuid, ApiError> {
    let id = path_id(path)?;
    let parsed = uuid::Uuid::parse_str(&id).map_err(|e| ApiError::invalid(e.to_string()))?;
    if parsed.to_string() != id {
        return Err(ApiError::invalid("group ID must be a canonical UUID"));
    }
    Ok(parsed)
}
#[utoipa::path(tag="settings",get,path="/api/v1/settings/definitions",responses((status=200,body=Vec<SettingsDefinition>)))]
async fn settings_definitions(
    State(state): State<Arc<Shared>>,
) -> Result<Json<Vec<SettingsDefinition>>, ApiError> {
    state.settings_definitions().await.map(Json)
}
#[utoipa::path(tag="settings",get,path="/api/v1/settings/media-runtime",responses((status=200,body=MediaSettingsRuntime)))]
async fn settings_runtime(
    State(state): State<Arc<Shared>>,
) -> Result<Json<MediaSettingsRuntime>, ApiError> {
    state.media_settings_runtime().await.map(Json)
}
#[utoipa::path(tag="settings",get,path="/api/v1/settings/groups/{group_id}",params(("group_id"=String,Path)),responses((status=200,body=SettingsObservation)))]
async fn read_settings(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<SettingsObservation>, ApiError> {
    state.settings_read(group(path)?).await.map(Json)
}
#[utoipa::path(tag="settings",post,path="/api/v1/settings/groups/{group_id}",params(("group_id"=String,Path)),request_body=ChangeSettings,responses((status=200,body=MutationOutcome)))]
async fn change_settings(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
    input: Result<Json<ChangeSettings>, JsonRejection>,
) -> Result<Json<MutationOutcome>, ApiError> {
    let id = group(path)?;
    let input = body(input)?;
    canonical_id(&input.request_id)?;
    state.settings_change(id, input).await.map(Json)
}
pub(crate) fn router() -> utoipa_axum::router::OpenApiRouter<Arc<Shared>> {
    use utoipa_axum::{router::OpenApiRouter, routes};
    OpenApiRouter::new()
        .routes(routes!(settings_definitions))
        .routes(routes!(settings_runtime))
        .routes(routes!(read_settings, change_settings))
}
