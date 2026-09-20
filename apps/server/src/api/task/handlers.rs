use super::dto::*;
use crate::api::{error::ApiError, request::path_id};
use crate::runtime::Shared;
use axum::{
    Json,
    extract::{Path, State, rejection::PathRejection},
    response::{
        Sse,
        sse::{Event, KeepAlive},
    },
};
use std::{convert::Infallible, sync::Arc, time::Duration};
#[utoipa::path(tag="task", get, path="/api/v1/tasks", responses((status=200, body=TaskSnapshot)))]
pub(super) async fn tasks(State(state): State<Arc<Shared>>) -> Json<TaskSnapshot> {
    Json(state.snapshot())
}
#[utoipa::path(tag="task", get, path="/api/v1/tasks/{task_id}", params(("task_id"=String, Path)), responses((status=200, body=PublicTask), (status=404, body=ApiError)))]
pub(super) async fn task(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<PublicTask>, ApiError> {
    state.task(&path_id(path)?).map(Json)
}
/// SSE `snapshot` events contain complete TaskSnapshot JSON, not a JSON response.
#[utoipa::path(tag="task", get, path="/api/v1/events", responses((status=200, content_type="text/event-stream", body=String, description="SSE stream. Each snapshot event has TaskSnapshot JSON in data, and its revision in id. Subscribe with the authorization/run headers; reconnect establishes a fresh replacement snapshot.")))]
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
pub(crate) fn router() -> utoipa_axum::router::OpenApiRouter<Arc<Shared>> {
    use utoipa_axum::{router::OpenApiRouter, routes};
    OpenApiRouter::new()
        .routes(routes!(tasks))
        .routes(routes!(task))
        .routes(routes!(events))
}
