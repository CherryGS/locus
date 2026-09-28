use super::schema::*;
use crate::{
    api::{
        error::{ApiError, ErrorCode},
        request::body,
    },
    runtime::Shared,
};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    response::{IntoResponse, Response},
};
use std::sync::Arc;
fn service(state: &Shared) -> Result<locus_search::api::SearchService, ApiError> {
    state.business()?;
    state
        .search
        .as_ref()
        .map_err(|e| ApiError::new(ErrorCode::LaunchRejected, e))
        .cloned()
}
fn failure(error: locus_search::api::SearchError) -> ApiError {
    use locus_search::api::SearchError;
    let code = match error {
        SearchError::Query(locus_query::api::QueryError::Invalid(_))
        | SearchError::Native(_)
        | SearchError::Request(_) => ErrorCode::InvalidRequest,
        SearchError::Unavailable(_) => ErrorCode::LaunchRejected,
        SearchError::ContextUnavailable => ErrorCode::NotFound,
        _ => ErrorCode::OperationFailed,
    };
    ApiError::new(code, error.to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn request_errors_and_corrupt_execution_have_distinct_statuses() {
        use crate::api::error::ErrorCode;
        use locus_query::api::QueryError;
        use locus_search::api::SearchError;
        assert_eq!(
            super::failure(SearchError::Request("bounds".into())).code,
            ErrorCode::InvalidRequest
        );
        assert_eq!(
            super::failure(SearchError::Query(QueryError::Invalid("type".into()))).code,
            ErrorCode::InvalidRequest
        );
        assert_eq!(
            super::failure(SearchError::Invalid("corrupt identity".into())).code,
            ErrorCode::OperationFailed
        );
        assert_eq!(
            super::failure(SearchError::Query(QueryError::Projection(
                "invalid selected row".into()
            )))
            .code,
            ErrorCode::OperationFailed
        );
    }
}
#[utoipa::path(get,path="/api/v1/search/catalogue",operation_id="search_catalogue",tag="search",responses((status=200,body=SearchCatalogueBody)))]
async fn catalogue(
    State(state): State<Arc<Shared>>,
) -> Result<Json<SearchCatalogueBody>, ApiError> {
    Ok(Json(SearchCatalogueBody(
        service(&state)?.catalogue().clone(),
    )))
}
#[utoipa::path(get,path="/api/v1/search/status",operation_id="search_status",tag="search",responses((status=200,body=SearchStatusBody)))]
async fn status(State(state): State<Arc<Shared>>) -> Result<Json<SearchStatusBody>, ApiError> {
    Ok(Json(SearchStatusBody(service(&state)?.status())))
}
#[utoipa::path(post,path="/api/v1/search/query",operation_id="search_query",tag="search",request_body=SearchQueryBody,responses((status=200,description="Complete ordered packed RFC UUIDv7 identities; 16 bytes per Entity. Context expires after the advertised lifetime.",body=Vec<u8>,content_type="application/octet-stream",headers(("Content-Length"=String),("X-Locus-Search-No-Filter"=String,description="true for ordinary enumeration; no search context/generation headers are supplied"),("X-Locus-Search-Context"=String),("X-Locus-Search-Generation"=String),("X-Locus-Search-Sequence"=String),("X-Locus-Search-Expires"=String)))))]
async fn query(
    State(state): State<Arc<Shared>>,
    input: Result<Json<SearchQueryBody>, JsonRejection>,
) -> Result<Response, ApiError> {
    let input = locus_filter::api::compile(body(input)?.0.into())
        .map_err(|d| attributed(ErrorCode::InvalidRequest, d.range, d.message))?;
    if input.source.text.trim().is_empty() {
        let bytes = state.entity_ids().await?;
        return Ok((
            [
                ("content-type", "application/octet-stream".to_owned()),
                ("content-length", bytes.len().to_string()),
                ("cache-control", "no-store".into()),
                ("x-locus-search-no-filter", "true".into()),
            ],
            bytes,
        )
            .into_response());
    }
    let range = locus_query::api::SourceRange {
        start: 0,
        end: input.source.text.len(),
    };
    let service = service(&state)?;
    let result = state.search_query(service, input).await?.map_err(|e| {
        let mut error = failure(e);
        error.diagnostic = Some(crate::api::error::DomainDiagnostic::Filter {
            start: range.start,
            end: range.end,
            message: error.message.clone(),
        });
        error
    })?;
    Ok((
        [
            ("content-type", "application/octet-stream".to_owned()),
            ("content-length", result.bytes.len().to_string()),
            ("cache-control", "no-store".into()),
            ("x-content-type-options", "nosniff".into()),
            ("x-locus-search-context", result.context),
            ("x-locus-search-generation", result.generation),
            ("x-locus-search-sequence", result.covered_sequence),
            (
                "x-locus-search-expires",
                result.expires_after_seconds.to_string(),
            ),
        ],
        result.bytes,
    )
        .into_response())
}
#[utoipa::path(post,path="/api/v1/search/evidence",operation_id="search_evidence",tag="search",request_body=ReadEvidence,responses((status=200,body=SearchEvidenceBody)))]
async fn evidence(
    State(state): State<Arc<Shared>>,
    input: Result<Json<ReadEvidence>, JsonRejection>,
) -> Result<Json<SearchEvidenceBody>, ApiError> {
    let input = body(input)?;
    let service = service(&state)?;
    let entities = input
        .entities
        .iter()
        .map(|id| crate::api::core::mapping::entity(id))
        .collect::<Result<Vec<_>, _>>()?;
    let result = state
        .search_evidence(service, input.context, entities)
        .await?
        .map_err(failure)?;
    Ok(Json(SearchEvidenceBody(result)))
}
#[utoipa::path(post,path="/api/v1/search/release",operation_id="search_release",tag="search",request_body=ReleaseContext,responses((status=204,description="Context released")))]
async fn release(
    State(state): State<Arc<Shared>>,
    input: Result<Json<ReleaseContext>, JsonRejection>,
) -> Result<axum::http::StatusCode, ApiError> {
    service(&state)?.release(&body(input)?.context);
    Ok(axum::http::StatusCode::NO_CONTENT)
}
#[utoipa::path(post,path="/api/v1/search/retry",operation_id="search_retry",tag="search",responses((status=202,description="Retry requested")))]
async fn retry(State(state): State<Arc<Shared>>) -> Result<axum::http::StatusCode, ApiError> {
    state.admit(&mut state.lock())?;
    service(&state)?.retry().map_err(failure)?;
    Ok(axum::http::StatusCode::ACCEPTED)
}
#[utoipa::path(post,path="/api/v1/search/rebuild",operation_id="search_rebuild",tag="search",responses((status=202,description="Rebuild requested")))]
async fn rebuild(State(state): State<Arc<Shared>>) -> Result<axum::http::StatusCode, ApiError> {
    state.admit(&mut state.lock())?;
    service(&state)?.rebuild().map_err(failure)?;
    Ok(axum::http::StatusCode::ACCEPTED)
}
pub(crate) fn router() -> utoipa_axum::router::OpenApiRouter<Arc<Shared>> {
    use utoipa_axum::{router::OpenApiRouter, routes};
    OpenApiRouter::new()
        .routes(routes!(catalogue))
        .routes(routes!(status))
        .routes(routes!(query))
        .routes(routes!(evidence))
        .routes(routes!(release))
        .routes(routes!(retry))
        .routes(routes!(rebuild))
}

fn attributed(code: ErrorCode, range: locus_query::api::SourceRange, message: String) -> ApiError {
    let mut e = ApiError::new(code, message.clone());
    e.diagnostic = Some(crate::api::error::DomainDiagnostic::Filter {
        start: range.start,
        end: range.end,
        message,
    });
    e
}
