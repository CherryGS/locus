#![allow(clippy::expect_used, clippy::unwrap_used)]
use super::{Server, ServerConfig};
use crate::api::{dto::MutationOutcome, tag::dto::TagChange};
use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use tower::ServiceExt;
async fn post(server: &Server, path: &str, input: Value) -> (StatusCode, Value) {
    let response = server
        .router()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(path)
                .header(
                    "authorization",
                    format!("Bearer {}", server.state.credential),
                )
                .header("x-locus-run", &server.state.run_id)
                .header("content-type", "application/json")
                .body(Body::from(input.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (
        status,
        if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap()
        },
    )
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn filter_assistance_live_services_http_schema_auth_precision_and_lifetime() {
    let root = tempfile::tempdir().unwrap();
    let server = Server::bind(ServerConfig::new(
        "test-credential-with-at-least-32-characters".into(),
        root.path().join("library"),
    ))
    .await
    .unwrap();
    let language = locus_filter::api::language();
    let profile = json!({"format":language.format,"version":language.version});
    let static_request =
        json!({"format":language.format,"version":language.version,"field":"tag_names_exact"});
    let (status, help) = post(&server, "/api/v1/filter/help", static_request.clone()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(help["reference"], "tag_names_exact");
    let (status,literal)=post(&server,"/api/v1/filter/literal",json!({"format":language.format,"version":language.version,"field":"file_byte_count","value":{"type":"uint","value":u64::MAX.to_string()}})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(literal["literal"], u64::MAX.to_string());
    let (status,editing)=post(&server,"/api/v1/filter/editing",json!({"source":{"format":language.format,"version":language.version,"text":"+@tag_names_exact:\"Straße"},"offset":25,"marker":1})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(editing["kind"], "value");
    let mut unknown = static_request.clone();
    unknown["field"] = json!("foreign");
    assert_eq!(
        post(&server, "/api/v1/filter/help", unknown).await.0,
        StatusCode::BAD_REQUEST
    );
    let mut old = static_request;
    old["version"] = json!(1);
    assert_eq!(
        post(&server, "/api/v1/filter/help", old).await.0,
        StatusCode::BAD_REQUEST
    );
    tokio::time::timeout(std::time::Duration::from_secs(20), async {
        while server.state.search.as_ref().unwrap().status().state != "ready" {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let entity = match server
        .state
        .create_entity(uuid::Uuid::now_v7().to_string())
        .await
        .unwrap()
    {
        MutationOutcome::EntityCreated { entity_id } => entity_id,
        _ => panic!(),
    };
    let tag = match server
        .state
        .tag_write(
            uuid::Uuid::now_v7().to_string(),
            TagChange::Create {
                name: "Straße".into(),
            },
        )
        .await
        .unwrap()
    {
        MutationOutcome::TagSaved { tag } => tag,
        _ => panic!(),
    };
    server
        .state
        .tag_write(
            uuid::Uuid::now_v7().to_string(),
            TagChange::Add {
                entity_id: entity,
                tag_id: tag.id,
            },
        )
        .await
        .unwrap();
    let (status, observation) = post(&server, "/api/v1/search/observation", Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(observation["expires_after_seconds"], 600);
    assert!(
        observation["matching_policy"]
            .as_str()
            .unwrap()
            .contains("16.0.0")
    );
    let context = observation["context"].as_str().unwrap();
    let (status, strings) = post(
        &server,
        "/api/v1/search/strings",
        json!({"context":context,"field":"tag_names","fragment":"STRASSE","limit":1}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(strings["values"], json!(["Straße"]));
    assert_eq!(strings["no_values"], false);
    let (status, bounds) = post(
        &server,
        "/api/v1/search/bounds",
        json!({"context":context,"field":"file_byte_count"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bounds, json!({"minimum":null,"maximum":null}));
    assert_eq!(
        post(
            &server,
            "/api/v1/search/strings",
            json!({"context":context,"field":"entity_id"})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        post(
            &server,
            "/api/v1/search/strings",
            json!({"context":context,"field":"tag_names","continuation":"foreign"})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        post(
            &server,
            "/api/v1/search/observation/release",
            json!({"context":context})
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        post(
            &server,
            "/api/v1/search/strings",
            json!({"context":context,"field":"tag_names"})
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let unauthorized = server
        .router()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/filter/help")
                .header("content-type", "application/json")
                .body(Body::from(profile.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);
    let wrong_run = server
        .router()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/search/observation")
                .header(
                    "authorization",
                    format!("Bearer {}", server.state.credential),
                )
                .header("x-locus-run", "another-run")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(wrong_run.status(), StatusCode::CONFLICT);
    let schema = crate::api::openapi().unwrap();
    let schema = serde_json::to_value(schema).unwrap();
    for path in [
        "/api/v1/filter/literal",
        "/api/v1/filter/help",
        "/api/v1/filter/editing",
        "/api/v1/search/observation",
        "/api/v1/search/strings",
        "/api/v1/search/bounds",
        "/api/v1/search/observation/release",
    ] {
        assert!(schema["paths"][path].is_object(), "{path}");
    }
    let catalogue = server.state.search.as_ref().unwrap().catalogue();
    assert_eq!(catalogue.fields.len(), 56);
    assert_eq!(
        catalogue
            .fields
            .iter()
            .filter(|f| f.assistance == locus_query::api::Assistance::Strings)
            .count(),
        24
    );
    assert_eq!(
        catalogue
            .fields
            .iter()
            .filter(|f| f.assistance == locus_query::api::Assistance::Bounds)
            .count(),
        13
    );
}
