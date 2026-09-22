use super::error::{ApiError, ErrorCode};
use crate::runtime::Shared;
use axum::{
    extract::{Request, State},
    middleware::Next,
    response::Response,
};
use std::sync::Arc;

pub(super) async fn authorize(
    State(state): State<Arc<Shared>>,
    request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    let headers = request.headers();
    let supplied = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    if !equal(supplied.as_bytes(), state.credential.as_bytes()) {
        return Err(ApiError::new(
            ErrorCode::Unauthorized,
            "Bearer authorization required",
        ));
    }
    if let Some(origin) = headers.get(axum::http::header::ORIGIN)
        && origin.to_str().ok() != Some(state.origin.as_str())
    {
        return Err(ApiError::new(
            ErrorCode::ForeignOrigin,
            "Foreign origin rejected",
        ));
    }
    if let Some(host) = headers.get(axum::http::header::HOST)
        && host.to_str().ok() != state.origin.strip_prefix("http://")
    {
        return Err(ApiError::new(
            ErrorCode::ForeignOrigin,
            "Unexpected host rejected",
        ));
    }
    if headers.get("x-locus-run").and_then(|v| v.to_str().ok()) != Some(state.run_id.as_str()) {
        return Err(ApiError::new(
            ErrorCode::WrongRun,
            "Expected backend run does not match; do not replay work automatically",
        ));
    }
    let path = request.uri().path();
    if state.domain.is_none()
        && path.starts_with("/api/")
        && !(path == "/api/v1/server"
            || path == "/api/v1/drain"
            || path.starts_with("/api/v1/settings/")
            || path.starts_with("/api/v1/requests/"))
    {
        return Err(ApiError::new(
            ErrorCode::Restricted,
            "Business routes unavailable during Settings repair",
        ));
    }
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        axum::http::header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("no-store"),
    );
    Ok(response)
}

fn equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0u8, |different, (a, b)| different | (a ^ b))
        == 0
}
