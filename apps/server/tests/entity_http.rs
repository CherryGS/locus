#![allow(clippy::expect_used, clippy::unwrap_used)]

use axum::{
    body::Body,
    http::{Request, StatusCode},
    response::Response,
};
use diesel_async::SimpleAsyncConnection;
use http_body_util::BodyExt;
use locus_core::api::{CoreError, EntityId, Kernel};
use locus_server::api::{Server, ServerConfig};
use locus_store::api::Session;
use serde_json::{Value, json};
use tower::ServiceExt;

const TOKEN: &str = "entity-read-test-credential-at-least-32-characters";
fn request(server: &Server, method: &str, path: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(path)
        .header("authorization", format!("Bearer {TOKEN}"))
        .header("x-locus-run", server.ready().run_id)
        .header("content-type", "application/json")
        .body(Body::from(if body.is_null() {
            String::new()
        } else {
            body.to_string()
        }))
        .unwrap()
}
async fn json(response: Response) -> Value {
    serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap()
}
async fn app() -> (tempfile::TempDir, Server) {
    let root = tempfile::tempdir().unwrap();
    let server = Server::bind(ServerConfig::new(TOKEN.into(), root.path().join("library")))
        .await
        .unwrap();
    (root, server)
}

#[tokio::test(flavor = "multi_thread")]
async fn binary_empty_complete_refresh_and_large_attributed_batch() {
    let (root, server) = app().await;
    let empty = server
        .router()
        .oneshot(request(&server, "GET", "/api/v1/entities", Value::Null))
        .await
        .unwrap();
    assert_eq!(empty.status(), StatusCode::OK);
    assert_eq!(empty.headers()["content-length"], "0");
    assert_eq!(empty.headers()["content-type"], "application/octet-stream");
    assert_eq!(empty.headers()["x-content-type-options"], "nosniff");
    assert_eq!(empty.headers()["cache-control"], "no-store");
    assert!(
        empty
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .is_empty()
    );
    let mut session = Session::open(root.path().join("library/metadata.sqlite"))
        .await
        .unwrap();
    let entities = session
        .transaction::<_, CoreError, _>(|context| {
            Box::pin(async move {
                let kernel = Kernel::new();
                let mut entities = Vec::new();
                for _ in 0..1001 {
                    entities.push(kernel.create_entity_in(context).await?);
                }
                Ok(entities)
            })
        })
        .await
        .unwrap();
    let enumeration = server
        .router()
        .oneshot(request(&server, "GET", "/api/v1/entities", Value::Null))
        .await
        .unwrap();
    assert_eq!(
        enumeration.headers()["content-length"],
        (entities.len() * 16).to_string()
    );
    let prior = enumeration.into_body().collect().await.unwrap().to_bytes();
    let observed: std::collections::HashSet<_> = prior
        .chunks_exact(16)
        .map(|id| EntityId::from_bytes(id).unwrap())
        .collect();
    assert_eq!(observed, entities.iter().copied().collect());
    Kernel::new()
        .delete_entity(&mut session, entities[500])
        .await
        .unwrap();
    let mut ids: Vec<_> = entities.iter().map(ToString::to_string).collect();
    ids.push(entities[0].to_string());
    let input = json!({"entity_ids": ids});
    assert!(input.to_string().len() > 16_384);
    let result = server
        .router()
        .oneshot(request(&server, "POST", "/api/v1/memberships/read", input))
        .await
        .unwrap();
    assert_eq!(result.status(), StatusCode::OK);
    let rows = json(result).await;
    assert_eq!(rows.as_array().unwrap().len(), ids.len());
    for (index, id) in ids.iter().enumerate() {
        assert_eq!(rows[index]["entity_id"], *id);
        assert_eq!(
            rows[index]["status"],
            if index == 500 { "missing" } else { "present" }
        );
        if index != 500 {
            assert_eq!(rows[index]["memberships"], json!([]));
        }
    }
    let refreshed = server
        .router()
        .oneshot(request(&server, "GET", "/api/v1/entities", Value::Null))
        .await
        .unwrap();
    assert_eq!(refreshed.headers()["content-length"], "16000");
    assert_eq!(prior.len(), 16016);
    // The exemption must not leak to the existing create-Entity POST.
    let oversized = json!({"request_id": "a".repeat(17_000)});
    let rejected = server
        .router()
        .oneshot(request(&server, "POST", "/api/v1/entities", oversized))
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
    let invalid = server
        .router()
        .oneshot(request(
            &server,
            "POST",
            "/api/v1/memberships/read",
            json!({"entity_ids": [uuid::Uuid::nil().to_string()]}),
        ))
        .await
        .unwrap();
    assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
    assert_eq!(json(invalid).await["code"], "invalid_request");
    let single = server
        .router()
        .oneshot(request(
            &server,
            "GET",
            &format!("/api/v1/entities/{}/memberships", entities[0]),
            Value::Null,
        ))
        .await
        .unwrap();
    assert_eq!(json(single).await, json!([]));
}

#[tokio::test(flavor = "multi_thread")]
async fn both_read_routes_authorize_check_run_and_return_json_on_failure() {
    let (root, server) = app().await;
    for (method, path, input) in [
        ("GET", "/api/v1/entities", Value::Null),
        (
            "POST",
            "/api/v1/memberships/read",
            json!({"entity_ids": []}),
        ),
    ] {
        let mut unauthorized = request(&server, method, path, input.clone());
        unauthorized.headers_mut().remove("authorization");
        let response = server.router().oneshot(unauthorized).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(json(response).await["code"], "unauthorized");
        let mut wrong = request(&server, method, path, input);
        wrong
            .headers_mut()
            .insert("x-locus-run", "wrong".parse().unwrap());
        let response = server.router().oneshot(wrong).await.unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert_eq!(json(response).await["code"], "wrong_run");
    }
    let mut session = Session::open(root.path().join("library/metadata.sqlite"))
        .await
        .unwrap();
    session.transaction::<_, CoreError, _>(|context| Box::pin(async move {
        context.connection().batch_execute("PRAGMA ignore_check_constraints = ON; INSERT INTO locus_entities VALUES (zeroblob(16));").await?;
        Ok(())
    })).await.unwrap();
    let failed = server
        .router()
        .oneshot(request(&server, "GET", "/api/v1/entities", Value::Null))
        .await
        .unwrap();
    assert_eq!(failed.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(failed.headers()["content-type"], "application/json");
    assert_eq!(json(failed).await["code"], "operation_failed");
    server.close_admission();
    let closed = server
        .router()
        .oneshot(request(
            &server,
            "POST",
            "/api/v1/memberships/read",
            json!({"entity_ids": []}),
        ))
        .await
        .unwrap();
    assert_eq!(closed.status(), StatusCode::SERVICE_UNAVAILABLE);
}
