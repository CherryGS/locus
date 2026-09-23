use super::dto::*;
use crate::{
    api::{
        dto::{OutcomeResponse, Receipt, Submission},
        error::{ApiError, ErrorCode},
        imports::dto::{ImportRecoveryRequest, ImportSnapshot, RegisteredImportRequest},
        request::{body, canonical_id},
        task::dto::{AccessContext, PublicTask, TaskSnapshot},
    },
    runtime::{Shared, external::Authorization},
};
use axum::{
    Extension, Json,
    extract::{Path, State, rejection::JsonRejection},
    middleware,
};
use std::sync::Arc;
use utoipa_axum::{router::OpenApiRouter, routes};
#[utoipa::path(operation_id="external_routes_upload",tag="external",post,path="/external/v1/uploads",params(("request_id"=String,Query),("byte_count"=String,Query),("filename"=Option<String>,Query)),request_body(content=String,content_type="application/octet-stream"),responses((status=202,body=Submission)))]
async fn upload(
    State(state): State<Arc<Shared>>,
    Extension(basis): Extension<Authorization>,
    query: Result<axum::extract::Query<UploadMetadata>, axum::extract::rejection::QueryRejection>,
    body: axum::body::Body,
) -> Result<(axum::http::StatusCode, Json<Submission>), ApiError> {
    let axum::extract::Query(metadata) =
        query.map_err(|error| ApiError::invalid(error.body_text()))?;
    canonical_id(&metadata.request_id)?;
    Ok((
        axum::http::StatusCode::ACCEPTED,
        Json(state.receive_upload(basis, metadata, body).await?),
    ))
}
#[utoipa::path(operation_id="external_upload_preflight",tag="external",options,path="/external/v1/uploads",responses((status=204,description="Unauthenticated CORS transport preflight; starts no work")))]
async fn upload_options() -> axum::http::StatusCode {
    axum::http::StatusCode::NO_CONTENT
}
#[utoipa::path(operation_id="external_import_preflight",tag="external",options,path="/external/v1/import-batches",responses((status=204,description="Unauthenticated CORS transport preflight; starts no work")))]
async fn import_options() -> axum::http::StatusCode {
    axum::http::StatusCode::NO_CONTENT
}
#[utoipa::path(operation_id="external_routes_upload_state",tag="external",get,path="/external/v1/uploads/{upload_id}",params(("upload_id"=String,Path)),responses((status=200,body=UploadObservation)))]
async fn upload_state(
    State(state): State<Arc<Shared>>,
    Path(id): Path<String>,
) -> Result<Json<UploadObservation>, ApiError> {
    state.upload_observation(&id).map(Json)
}
#[utoipa::path(operation_id="external_routes_upload_recovery",tag="external",post,path="/external/v1/upload-recoveries",request_body=RecoverUpload,responses((status=202,body=Receipt)))]
async fn upload_recovery(
    State(state): State<Arc<Shared>>,
    Extension(basis): Extension<Authorization>,
    json: Result<Json<RecoverUpload>, JsonRejection>,
) -> Result<(axum::http::StatusCode, Json<Receipt>), ApiError> {
    let request = body(json)?;
    canonical_id(&request.request_id)?;
    state
        .recover_upload(basis, request)
        .map(|receipt| (axum::http::StatusCode::ACCEPTED, Json(receipt)))
}
#[utoipa::path(operation_id="external_routes_bootstrap",tag="external",get,path="/external/v1/bootstrap",responses((status=200,body=ExternalBootstrap)))]
async fn bootstrap(State(state): State<Arc<Shared>>) -> Json<ExternalBootstrap> {
    Json(ExternalBootstrap {
        run_id: state.run_id.clone(),
    })
}
#[utoipa::path(operation_id="external_routes_import",tag="external",post,path="/external/v1/import-batches",request_body=RegisteredImportRequest,responses((status=202,body=Submission)))]
async fn import(
    State(state): State<Arc<Shared>>,
    Extension(basis): Extension<Authorization>,
    json: Result<Json<RegisteredImportRequest>, JsonRejection>,
) -> Result<(axum::http::StatusCode, Json<Submission>), ApiError> {
    let request = body(json)?;
    canonical_id(&request.request_id)?;
    Ok((
        axum::http::StatusCode::ACCEPTED,
        Json(state.registered_import_in(AccessContext::External, Some(basis), request)?),
    ))
}
#[utoipa::path(operation_id="external_routes_recover",tag="external",post,path="/external/v1/import-recoveries",request_body=ImportRecoveryRequest,responses((status=202,body=Receipt)))]
async fn recover(
    State(state): State<Arc<Shared>>,
    Extension(basis): Extension<Authorization>,
    json: Result<Json<ImportRecoveryRequest>, JsonRejection>,
) -> Result<(axum::http::StatusCode, Json<Receipt>), ApiError> {
    let request = body(json)?;
    canonical_id(&request.request_id)?;
    state
        .recover_import_in(AccessContext::External, Some(basis), request)
        .map(|receipt| (axum::http::StatusCode::ACCEPTED, Json(receipt)))
}
#[utoipa::path(operation_id="external_routes_batches",tag="external",get,path="/external/v1/import-batches",responses((status=200,body=ImportSnapshot)))]
async fn batches(State(state): State<Arc<Shared>>) -> Json<ImportSnapshot> {
    let mut snapshot = state.import_snapshot();
    snapshot
        .batches
        .retain(|b| b.access_context == AccessContext::External);
    Json(snapshot)
}
#[utoipa::path(operation_id="external_routes_request",tag="external",get,path="/external/v1/requests/{request_id}",params(("request_id"=String,Path)),responses((status=200,body=Submission)))]
async fn request(
    State(state): State<Arc<Shared>>,
    Path(id): Path<String>,
) -> Result<Json<Submission>, ApiError> {
    state.external_submission(&id).map(Json)
}
#[utoipa::path(operation_id="external_routes_tasks",tag="external",get,path="/external/v1/tasks",responses((status=200,body=TaskSnapshot)))]
async fn tasks(State(state): State<Arc<Shared>>) -> Json<TaskSnapshot> {
    Json(snapshot(&state))
}
fn snapshot(state: &Shared) -> TaskSnapshot {
    let mut snapshot = state.snapshot();
    snapshot
        .tasks
        .retain(|t| t.access_context == AccessContext::External);
    snapshot
}
#[utoipa::path(operation_id="external_routes_task",tag="external",get,path="/external/v1/tasks/{task_id}",params(("task_id"=String,Path)),responses((status=200,body=PublicTask)))]
async fn task(
    State(state): State<Arc<Shared>>,
    Path(id): Path<String>,
) -> Result<Json<PublicTask>, ApiError> {
    Ok(Json(owned_task(&state, &id)?))
}
fn owned_task(state: &Shared, id: &str) -> Result<PublicTask, ApiError> {
    let task = state.task(id)?;
    if task.access_context != AccessContext::External {
        return Err(ApiError::new(
            ErrorCode::UnknownTask,
            "Unknown task in this external context",
        ));
    }
    Ok(task)
}
#[utoipa::path(operation_id="external_routes_outcome",tag="external",get,path="/external/v1/tasks/{task_id}/outcome",params(("task_id"=String,Path)),responses((status=200,body=OutcomeResponse)))]
async fn outcome(
    State(state): State<Arc<Shared>>,
    Path(id): Path<String>,
) -> Result<Json<OutcomeResponse>, ApiError> {
    owned_task(&state, &id)?;
    state.outcome(&id).map(Json)
}
#[utoipa::path(operation_id="external_routes_events",tag="external",get,path="/external/v1/task-events",responses((status=200,description="External-context replacement task snapshots",content_type="text/event-stream")))]
async fn events(
    State(state): State<Arc<Shared>>,
    Extension(basis): Extension<Authorization>,
) -> axum::response::Sse<
    impl futures_core::Stream<Item = Result<axum::response::sse::Event, std::convert::Infallible>>,
> {
    let mut changes = state.changes.subscribe();
    let mut credentials = state.access.changed.subscribe();
    let mut drained = state.drained.subscribe();
    axum::response::Sse::new(async_stream::stream! {
        loop {
            #[cfg(test)]
            {let pause=state.access.pause_event.lock().unwrap().take();if let Some((entered,release))=pause {if state.external_current(&basis).is_err(){break;}entered.notify_one();release.notified().await;}}
            let Ok(event)=external_event(&state,&basis) else {break;};
            yield Ok(event);
            tokio::select! {r=changes.changed()=>if r.is_err(){break},_=credentials.changed()=>break,_=drained.changed()=>break}
        }
    })
}
fn external_event(
    state: &Shared,
    basis: &Authorization,
) -> Result<axum::response::sse::Event, ApiError> {
    // The same short gate orders reset publication and frame production. No
    // guard survives a stream suspension; serialization is part of this boundary.
    let registry = state.lock();
    state.external_current(basis)?;
    let mut snapshot = state.snapshot_in(&registry);
    snapshot
        .tasks
        .retain(|t| t.access_context == AccessContext::External);
    axum::response::sse::Event::default()
        .event("tasks")
        .json_data(snapshot)
        .map_err(|_| ApiError::new(ErrorCode::OperationFailed, "Could not encode task snapshot"))
}
pub(crate) fn registered() -> OpenApiRouter<Arc<Shared>> {
    OpenApiRouter::new()
        .routes(routes!(upload, upload_options))
        .routes(routes!(upload_state))
        .routes(routes!(upload_recovery))
        .routes(routes!(bootstrap))
        .routes(routes!(import, batches, import_options))
        .routes(routes!(recover))
        .routes(routes!(request))
        .routes(routes!(tasks))
        .routes(routes!(task))
        .routes(routes!(outcome))
        .routes(routes!(events))
}
pub(crate) fn router(state: Arc<Shared>) -> axum::Router {
    let (router, _) = registered().split_for_parts();
    router
        .fallback(crate::api::handlers::not_found)
        .method_not_allowed_fallback(crate::api::handlers::method_not_allowed)
        .layer(axum::extract::DefaultBodyLimit::disable())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            super::auth::authorize,
        ))
        .with_state(state)
}
