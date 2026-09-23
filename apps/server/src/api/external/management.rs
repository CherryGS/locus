use super::dto::{ExternalRuntime, ResetToken, TokenObservation};
use crate::{
    api::{
        dto::MutationOutcome,
        error::ApiError,
        request::{body, canonical_id},
    },
    runtime::Shared,
};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
};
use std::sync::Arc;
#[utoipa::path(operation_id="external_management_runtime",tag="external-access",get,path="/api/v1/external-access/runtime",responses((status=200,body=ExternalRuntime)))]
async fn runtime(State(state): State<Arc<Shared>>) -> Json<ExternalRuntime> {
    Json(
        state
            .access
            .runtime
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone(),
    )
}
#[utoipa::path(operation_id="external_management_token",tag="external-access",get,path="/api/v1/external-access/token",responses((status=200,body=TokenObservation)))]
async fn token(State(state): State<Arc<Shared>>) -> Result<Json<TokenObservation>, ApiError> {
    state.token_read().await.map(Json)
}
#[utoipa::path(operation_id="external_management_reset",tag="external-access",post,path="/api/v1/external-access/token/reset",request_body=ResetToken,responses((status=200,body=MutationOutcome)))]
async fn reset(
    State(state): State<Arc<Shared>>,
    json: Result<Json<ResetToken>, JsonRejection>,
) -> Result<Json<MutationOutcome>, ApiError> {
    let request = body(json)?;
    canonical_id(&request.request_id)?;
    canonical_id(&request.expected_revision)?;
    state.token_reset(request).await.map(Json)
}
pub(crate) fn router() -> utoipa_axum::router::OpenApiRouter<Arc<Shared>> {
    use utoipa_axum::{router::OpenApiRouter, routes};
    OpenApiRouter::new()
        .routes(routes!(runtime))
        .routes(routes!(token))
        .routes(routes!(reset))
}
