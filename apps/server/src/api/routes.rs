use super::{auth, dto::*, error::ApiError, handlers};
use crate::runtime::Shared;
use axum::{Router, middleware, response::IntoResponse, routing::get};
use std::sync::Arc;
use utoipa::{
    OpenApi,
    openapi::{
        self, Ref, RefOr,
        path::{ParameterBuilder, ParameterIn},
        response::ResponseBuilder,
        security::{HttpAuthScheme, HttpBuilder, SecurityScheme},
    },
};
use utoipa_axum::{router::OpenApiRouter, routes};

#[derive(OpenApi)]
#[openapi(
    info(title = "Locus loopback API", version = "1.0.0"),
    components(schemas(ApiError, TaskSnapshot, ImportOutcome))
)]
struct Contract;

fn registered() -> OpenApiRouter<Arc<Shared>> {
    OpenApiRouter::with_openapi(Contract::openapi())
        .routes(routes!(handlers::status))
        .routes(routes!(handlers::import))
        .routes(routes!(handlers::read))
        .routes(routes!(handlers::submission))
        .routes(routes!(handlers::tasks))
        .routes(routes!(handlers::task))
        .routes(routes!(handlers::outcome))
        .routes(routes!(handlers::drain))
        .routes(routes!(handlers::events))
}

pub fn openapi() -> anyhow::Result<openapi::OpenApi> {
    let (_, mut document) = registered().split_for_parts();
    if let Some(components) = document.components.as_mut() {
        components.add_security_scheme(
            "bearer",
            SecurityScheme::Http(HttpBuilder::new().scheme(HttpAuthScheme::Bearer).build()),
        );
    }
    document.security = Some(vec![openapi::security::SecurityRequirement::new(
        "bearer",
        std::iter::empty::<&str>(),
    )]);
    for item in document.paths.paths.values_mut() {
        for operation in [
            &mut item.get,
            &mut item.post,
            &mut item.put,
            &mut item.delete,
            &mut item.patch,
            &mut item.options,
            &mut item.head,
        ]
        .into_iter()
        .flatten()
        {
            operation.parameters.get_or_insert_with(Vec::new).push(
                ParameterBuilder::new().name("X-Locus-Run").parameter_in(ParameterIn::Header)
                    .required(openapi::Required::True)
                    .description(Some("Expected backend run from private readiness; context, not authorization. Never silently replace it."))
                    .schema(Some(openapi::ObjectBuilder::new().schema_type(openapi::Type::String))).build()
            );
            for (status, description) in [
                (400, "Invalid request"),
                (401, "Missing or invalid authorization"),
                (403, "Foreign origin or host"),
                (405, "Method not allowed"),
                (409, "Wrong run or conflicting request ID"),
                (500, "Operation failure"),
                (503, "Admission closed or retained launch rejection"),
            ] {
                operation
                    .responses
                    .responses
                    .entry(status.to_string())
                    .or_insert_with(|| {
                        RefOr::T(
                            ResponseBuilder::new()
                                .description(description)
                                .content(
                                    "application/json",
                                    openapi::Content::new(Some(Ref::from_schema_name("ApiError"))),
                                )
                                .build(),
                        )
                    });
            }
        }
    }
    Ok(document)
}

pub(crate) fn router(state: Arc<Shared>) -> anyhow::Result<Router> {
    let (router, _) = registered().split_for_parts();
    // Serialize once per server, rather than generating OpenAPI for business calls.
    let schema = Arc::new(openapi()?.to_json()?);
    Ok(router
        .route(
            "/api/v1/openapi.json",
            get(move || {
                let schema = schema.clone();
                async move {
                    (
                        [(axum::http::header::CONTENT_TYPE, "application/json")],
                        (*schema).clone(),
                    )
                        .into_response()
                }
            }),
        )
        .fallback(handlers::not_found)
        .method_not_allowed_fallback(handlers::method_not_allowed)
        .layer(axum::extract::DefaultBodyLimit::max(16_384))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::authorize,
        ))
        .with_state(state))
}
