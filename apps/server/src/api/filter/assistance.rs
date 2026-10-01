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
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::{
    PartialSchema, ToSchema,
    openapi::{Ref, RefOr, schema::Schema},
};
macro_rules! transport {
    ($name:ident,$type:ty,$schema:literal) => {
        #[derive(Serialize, Deserialize)]
        #[serde(transparent)]
        struct $name($type);
        impl PartialSchema for $name {
            fn schema() -> RefOr<Schema> {
                Ref::from_schema_name($schema).into()
            }
        }
        impl ToSchema for $name {}
    };
}
transport!(
    LiteralInput,
    locus_filter::api::LiteralRequest,
    "FilterLiteralRequestData"
);
transport!(LiteralBody, locus_filter::api::Literal, "FilterLiteralData");
transport!(
    HelpInput,
    locus_filter::api::FieldHelpRequest,
    "FilterFieldHelpRequestData"
);
transport!(
    HelpBody,
    locus_filter::api::FieldHelp,
    "FilterFieldHelpData"
);
transport!(
    EditingInput,
    locus_filter::api::EditingRequest,
    "FilterEditingRequestData"
);
transport!(
    EditingBody,
    locus_filter::api::EditingContext,
    "FilterEditingData"
);
fn failure(diagnostic: locus_query::api::Diagnostic) -> ApiError {
    let mut error = ApiError::new(ErrorCode::InvalidRequest, diagnostic.message.clone());
    error.diagnostic = Some(crate::api::error::DomainDiagnostic::Filter {
        start: diagnostic.range.start,
        end: diagnostic.range.end,
        message: diagnostic.message,
    });
    error
}
fn catalogue(state: &Shared) -> Result<&locus_query::api::Catalogue, ApiError> {
    state.business()?;
    state
        .search
        .as_ref()
        .map(|s| s.catalogue())
        .map_err(|e| ApiError::new(ErrorCode::LaunchRejected, e))
}
#[utoipa::path(post,path="/api/v1/filter/literal",operation_id="filter_literal",tag="filter",request_body=LiteralInput,responses((status=200,body=LiteralBody)))]
async fn literal(
    State(state): State<Arc<Shared>>,
    input: Result<Json<LiteralInput>, JsonRejection>,
) -> Result<Json<LiteralBody>, ApiError> {
    Ok(Json(LiteralBody(
        locus_filter::api::literal(catalogue(&state)?, body(input)?.0).map_err(failure)?,
    )))
}
#[utoipa::path(post,path="/api/v1/filter/help",operation_id="filter_help",tag="filter",request_body=HelpInput,responses((status=200,body=HelpBody)))]
async fn help(
    State(state): State<Arc<Shared>>,
    input: Result<Json<HelpInput>, JsonRejection>,
) -> Result<Json<HelpBody>, ApiError> {
    Ok(Json(HelpBody(
        locus_filter::api::field_help(catalogue(&state)?, body(input)?.0).map_err(failure)?,
    )))
}
#[utoipa::path(post,path="/api/v1/filter/editing",operation_id="filter_editing",tag="filter",request_body=EditingInput,responses((status=200,body=EditingBody)))]
async fn editing(
    State(state): State<Arc<Shared>>,
    input: Result<Json<EditingInput>, JsonRejection>,
) -> Result<Json<EditingBody>, ApiError> {
    Ok(Json(EditingBody(
        locus_filter::api::editing_context(catalogue(&state)?, body(input)?.0).map_err(failure)?,
    )))
}
pub(crate) fn router() -> utoipa_axum::router::OpenApiRouter<Arc<Shared>> {
    use utoipa_axum::{router::OpenApiRouter, routes};
    OpenApiRouter::new()
        .routes(routes!(literal))
        .routes(routes!(help))
        .routes(routes!(editing))
}
