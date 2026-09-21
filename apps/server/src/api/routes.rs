use super::{
    auth, core,
    dto::TaskOutcome,
    error::ApiError,
    file, handlers, media, preferences,
    task::{self, dto::TaskSnapshot},
};
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
use utoipa_axum::router::OpenApiRouter;

#[derive(OpenApi)]
#[openapi(
    info(title = "Locus loopback API", version = "1.0.0"),
    components(schemas(ApiError, TaskSnapshot, TaskOutcome))
)]
struct Contract;

fn registered() -> OpenApiRouter<Arc<Shared>> {
    OpenApiRouter::with_openapi(Contract::openapi())
        .merge(core::router())
        .merge(file::router())
        .merge(media::router())
        .merge(preferences::router())
        .merge(task::router())
        .merge(handlers::router())
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
    // OpenAPI's binary string describes bytes, not a JSON array of integers.
    for (path, mime) in [
        ("/api/v1/entities", "application/octet-stream"),
        ("/api/v1/files/{file_id}/bytes", "application/octet-stream"),
        ("/api/v1/previews/{locator}/bytes", "image/png"),
    ] {
        if let Some(operation) = document
            .paths
            .paths
            .get_mut(path)
            .and_then(|p| p.get.as_mut())
            && let Some(RefOr::T(response)) = operation.responses.responses.get_mut("200")
            && let Some(content) = response.content.get_mut(mime)
        {
            content.schema = Some(
                openapi::ObjectBuilder::new()
                    .schema_type(openapi::Type::String)
                    .format(Some(openapi::SchemaFormat::KnownFormat(
                        openapi::KnownFormat::Binary,
                    )))
                    .build()
                    .into(),
            );
        }
    }
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

pub(crate) async fn router(
    state: Arc<Shared>,
    renderer_root: Option<std::path::PathBuf>,
) -> anyhow::Result<Router> {
    let (router, _) = registered().split_for_parts();
    // Serialize once per server, rather than generating OpenAPI for business calls.
    let schema = Arc::new(openapi()?.to_json()?);
    let router = super::renderer::attach(router, renderer_root).await?;
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
