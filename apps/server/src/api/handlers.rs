use super::{
    dto::*,
    error::{ApiError, ErrorCode},
};
use crate::runtime::Shared;
use axum::{
    Json,
    extract::{
        Path, State,
        rejection::{JsonRejection, PathRejection},
    },
    http::StatusCode,
    response::{
        Sse,
        sse::{Event, KeepAlive},
    },
};
use std::{convert::Infallible, sync::Arc, time::Duration};

#[utoipa::path(get, path="/api/v1/server", responses((status=200, body=ServerStatus)))]
pub(super) async fn status(State(state): State<Arc<Shared>>) -> Json<ServerStatus> {
    Json(state.status())
}

#[utoipa::path(post, path="/api/v1/imports", request_body=ImportRequest, responses((status=202, body=Receipt)))]
pub(super) async fn import(
    State(state): State<Arc<Shared>>,
    body: Result<Json<ImportRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<Receipt>), ApiError> {
    let Json(request) =
        body.map_err(|_| ApiError::invalid("Expected a valid import JSON object"))?;
    canonical_id(&request.request_id)?;
    if request.source_path.len() > 8192
        || request.source_path.contains('\0')
        || !std::path::Path::new(&request.source_path).is_absolute()
    {
        return Err(ApiError::invalid(
            "source_path must be an absolute local path of at most 8192 UTF-8 bytes",
        ));
    }
    Ok((StatusCode::ACCEPTED, Json(state.import(request)?)))
}

#[utoipa::path(get, path="/api/v1/files/{file_id}", params(("file_id"=String, Path)), responses((status=200, body=FileMetadata), (status=404, body=ApiError)))]
pub(super) async fn read(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<FileMetadata>, ApiError> {
    let id = path_id(path)?;
    let uuid = canonical_id(&id)?;
    let id = locus_file::api::FileId::from_bytes(uuid.as_bytes())
        .map_err(|_| ApiError::invalid("file_id must be a UUIDv7"))?;
    state.read(id).await.map(Json)
}

#[utoipa::path(get, path="/api/v1/requests/{request_id}", params(("request_id"=String, Path)), responses((status=200, body=Submission), (status=404, body=ApiError)))]
pub(super) async fn submission(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<Submission>, ApiError> {
    state.submission(&path_id(path)?).map(Json)
}

#[utoipa::path(get, path="/api/v1/tasks", responses((status=200, body=TaskSnapshot)))]
pub(super) async fn tasks(State(state): State<Arc<Shared>>) -> Json<TaskSnapshot> {
    Json(state.snapshot())
}

#[utoipa::path(get, path="/api/v1/tasks/{task_id}", params(("task_id"=String, Path)), responses((status=200, body=PublicTask), (status=404, body=ApiError)))]
pub(super) async fn task(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<PublicTask>, ApiError> {
    state.task(&path_id(path)?).map(Json)
}

#[utoipa::path(get, path="/api/v1/tasks/{task_id}/outcome", params(("task_id"=String, Path)), responses((status=200, body=OutcomeResponse), (status=404, body=ApiError)))]
pub(super) async fn outcome(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<OutcomeResponse>, ApiError> {
    state.outcome(&path_id(path)?).map(Json)
}

#[utoipa::path(post, path="/api/v1/drain", responses((status=200, body=ServerStatus)))]
pub(super) async fn drain(State(state): State<Arc<Shared>>) -> Json<ServerStatus> {
    Json(state.close())
}

/// SSE `snapshot` events contain complete TaskSnapshot JSON, not a JSON response.
#[utoipa::path(get, path="/api/v1/events", responses((status=200, content_type="text/event-stream", body=String, description="SSE stream. Each snapshot event has TaskSnapshot JSON in data, and its revision in id. Subscribe with the authorization/run headers; reconnect establishes a fresh replacement snapshot.")))]
pub(super) async fn events(
    State(state): State<Arc<Shared>>,
) -> Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>> {
    let mut changes = state.changes.subscribe();
    let mut drained = state.drained.subscribe();
    let stream = async_stream::stream! {
        // Subscribe first; a concurrent update can cause a duplicate snapshot but
        // cannot fall into the gap between initial state and subscription.
        loop {
            changes.borrow_and_update();
            // Sample closure before taking this snapshot. The stream may be
            // suspended at yield while completion/drain occurs; checking the
            // live flag afterward could close on an obsolete projection.
            let final_snapshot = *drained.borrow_and_update();
            let snapshot = state.snapshot();
            if let Ok(event) = Event::default().event("snapshot").id(snapshot.revision.clone()).json_data(&snapshot) { yield Ok(event); }
            if final_snapshot { break; }
            tokio::select! {
                changed = changes.changed() => { if changed.is_err() { break; } },
                _ = drained.changed() => { continue; },
            }
            // Coalesce copy progress and slow consumers without serializing the
            // entire retained projection for every 64 KiB File progress update.
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis(50)) => {},
                _ = drained.changed() => {},
            }
        }
    };
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

pub(super) async fn not_found() -> ApiError {
    ApiError::new(ErrorCode::NotFound, "Unknown API route")
}
pub(super) async fn method_not_allowed() -> ApiError {
    ApiError::new(ErrorCode::MethodNotAllowed, "Method not allowed")
}

pub(crate) fn canonical_id(id: &str) -> Result<uuid::Uuid, ApiError> {
    let parsed = uuid::Uuid::parse_str(id)
        .map_err(|_| ApiError::invalid("Identity must be a canonical hyphenated UUID"))?;
    if parsed.to_string() != id {
        return Err(ApiError::invalid(
            "Identity must be a canonical lowercase hyphenated UUID",
        ));
    }
    Ok(parsed)
}
pub(crate) fn path_id(path: Result<Path<String>, PathRejection>) -> Result<String, ApiError> {
    let Path(value) = path.map_err(|_| ApiError::invalid("Invalid path identity"))?;
    canonical_id(&value)?;
    Ok(value)
}
