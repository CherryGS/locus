use crate::{
    api::error::{ApiError, ErrorCode},
    runtime::Shared,
};
use axum::{
    extract::{Request, State},
    http::{HeaderValue, Method, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::sync::Arc;
pub(super) async fn authorize(
    State(state): State<Arc<Shared>>,
    mut request: Request,
    next: Next,
) -> Response {
    let response = async {
        let address = state
            .access
            .runtime
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .active_address
            .clone();
        let expected = address
            .as_deref()
            .ok_or_else(|| ApiError::new(ErrorCode::AccessDenied, "External entry unavailable"))?;
        if request
            .headers()
            .get(header::HOST)
            .and_then(|v| v.to_str().ok())
            != Some(expected)
        {
            return Err(ApiError::new(
                ErrorCode::ForeignOrigin,
                "Foreign loopback host",
            ));
        }
        if request.method() == Method::OPTIONS {
            return Ok(StatusCode::NO_CONTENT.into_response());
        }
        if request.method() == Method::GET && request.uri().path() == "/external/v1/bootstrap" {
            return Ok(next.run(request).await);
        }
        let token = request
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or_else(|| {
                ApiError::new(ErrorCode::Unauthorized, "External bearer Token required")
            })?;
        let authorization = state.external_authorize(token)?;
        if request
            .headers()
            .get("X-Locus-Run")
            .and_then(|v| v.to_str().ok())
            != Some(&state.run_id)
        {
            return Err(ApiError::new(
                ErrorCode::WrongRun,
                "Expected current backend run",
            ));
        }
        request.extensions_mut().insert(authorization.clone());
        let response = next.run(request).await;
        state.external_current(&authorization)?;
        Ok(response)
    }
    .await;
    let mut response = response.unwrap_or_else(IntoResponse::into_response);
    let headers = response.headers_mut();
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Authorization, Content-Type, X-Locus-Run"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}
