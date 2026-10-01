use super::dto::*;
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
    extract::{Path, State, rejection::JsonRejection},
};
use std::sync::Arc;
#[utoipa::path(get,path="/api/v1/filter/language",tag="filter",responses((status=200,body=FilterLanguage)))]
async fn language(State(state): State<Arc<Shared>>) -> Result<Json<FilterLanguage>, ApiError> {
    state.business()?;
    let l = locus_filter::api::language();
    Ok(Json(FilterLanguage {
        format: l.format.into(),
        version: l.version,
        offset_encoding: l.offset_encoding.into(),
        syntax: l.syntax.iter().map(|s| (*s).into()).collect(),
    }))
}
#[utoipa::path(get,path="/api/v1/filter/presets",tag="filter",responses((status=200,body=Vec<FilterPresetSummary>)))]
async fn presets(
    State(state): State<Arc<Shared>>,
) -> Result<Json<Vec<FilterPresetSummary>>, ApiError> {
    state.filter_presets().await.map(Json)
}
#[utoipa::path(get,path="/api/v1/filter/presets/{id}",tag="filter",params(("id"=String,Path)),responses((status=200,body=FilterPreset)))]
async fn preset(
    State(state): State<Arc<Shared>>,
    Path(id): Path<String>,
) -> Result<Json<FilterPreset>, ApiError> {
    state.filter_preset(id).await.map(Json)
}
#[utoipa::path(post,path="/api/v1/filter/presets",tag="filter",request_body=WriteFilterPreset,responses((status=200,body=MutationOutcome)))]
async fn write(
    State(state): State<Arc<Shared>>,
    input: Result<Json<WriteFilterPreset>, JsonRejection>,
) -> Result<Json<MutationOutcome>, ApiError> {
    let input = body(input)?;
    canonical_id(&input.request_id)?;
    state
        .filter_write(input.request_id, input.change)
        .await
        .map(Json)
}
#[utoipa::path(post,path="/api/v1/filter/analyze",tag="filter",request_body=FilterSource,responses((status=200,body=FilterAnalysis)))]
async fn analyze(
    State(state): State<Arc<Shared>>,
    input: Result<Json<FilterSource>, JsonRejection>,
) -> Result<Json<FilterAnalysis>, ApiError> {
    let source = body(input)?;
    state.business()?;
    let mut result = FilterAnalysis {
        source: source.clone(),
        state: "valid".into(),
        diagnostics: Vec::new(),
        parsed: None,
    };
    match locus_filter::api::inspect(source.into()) {
        Err(d) => {
            let language = locus_filter::api::language();
            result.state = if result.source.format != language.format
                || result.source.version != language.version
            {
                "unsupported"
            } else {
                "invalid"
            }
            .into();
            result.diagnostics.push(FilterDiagnostic {
                start: d.range.start,
                end: d.range.end,
                message: d.message,
            });
        }
        Ok(inspection) => {
            result.parsed = inspection.parsed;
            let p = inspection.program;
            if p.source.text.trim().is_empty() {
                result.state = "empty".into();
            } else {
                match &state.search {
                    Err(e) => {
                        result.state = "unavailable".into();
                        result.diagnostics.push(FilterDiagnostic {
                            start: 0,
                            end: p.source.text.len(),
                            message: e.clone(),
                        });
                    }
                    Ok(search) => {
                        if let Err(e) = search.analyze_program(&p) {
                            result.state =
                                if matches!(e, locus_search::api::SearchError::Unavailable(_)) {
                                    "unavailable"
                                } else {
                                    "invalid"
                                }
                                .into();
                            result.diagnostics.push(FilterDiagnostic {
                                start: 0,
                                end: p.source.text.len(),
                                message: e.to_string(),
                            });
                        }
                    }
                }
            }
        }
    }
    Ok(Json(result))
}
pub(crate) fn router() -> utoipa_axum::router::OpenApiRouter<Arc<Shared>> {
    use utoipa_axum::{router::OpenApiRouter, routes};
    OpenApiRouter::new()
        .merge(super::assistance::router())
        .routes(routes!(language))
        .routes(routes!(presets, write))
        .routes(routes!(preset))
        .routes(routes!(analyze))
}
