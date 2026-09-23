#![allow(clippy::expect_used, clippy::unwrap_used)]

use axum::{
    body::Body,
    http::{Request, StatusCode},
    response::Response,
};
use http_body_util::BodyExt;
use locus_server::api::{Server, ServerConfig};
use serde_json::{Value, json};
use tower::ServiceExt;

const TOKEN: &str = "http-test-credential-at-least-32-characters";
async fn app() -> (tempfile::TempDir, Server) {
    let root = tempfile::tempdir().unwrap();
    let server = Server::bind(ServerConfig::new(TOKEN.into(), root.path().join("library")))
        .await
        .unwrap();
    (root, server)
}
fn request(server: &Server, method: &str, path: &str, body: Option<Value>) -> Request<Body> {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("authorization", format!("Bearer {TOKEN}"))
        .header("x-locus-run", server.ready().run_id);
    if body.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    builder
        .body(Body::from(
            body.map(|value| value.to_string()).unwrap_or_default(),
        ))
        .unwrap()
}
async fn value(response: Response) -> Value {
    serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap()
}
async fn call(
    server: &Server,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let response = server
        .router()
        .oneshot(request(server, method, path, body))
        .await
        .unwrap();
    (response.status(), value(response).await)
}
async fn event(body: &mut Body) -> Value {
    let frame = tokio::time::timeout(std::time::Duration::from_secs(10), body.frame())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
        .into_data()
        .unwrap();
    let text = std::str::from_utf8(&frame).unwrap();
    let data = text
        .lines()
        .find_map(|line| line.strip_prefix("data: "))
        .unwrap();
    serde_json::from_str(data).unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn all_surfaces_authorize_run_origin_before_any_claim_and_use_typed_rejections() {
    let (root, server) = app().await;
    for path in [
        "/api/v1/server",
        "/api/v1/tasks",
        "/api/v1/events",
        "/api/v1/openapi.json",
        "/unknown",
    ] {
        let mut message = request(&server, "GET", path, None);
        message.headers_mut().remove("authorization");
        let response = server.router().oneshot(message).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(value(response).await["code"], "unauthorized");
    }
    let id = uuid::Uuid::now_v7().to_string();
    let input = json!({"request_id":id,"source_path": root.path().join("not-created")});
    for (header, supplied, status, code) in [
        (
            "x-locus-run",
            "previous-run",
            StatusCode::CONFLICT,
            "wrong_run",
        ),
        (
            "origin",
            "https://foreign.example",
            StatusCode::FORBIDDEN,
            "foreign_origin",
        ),
        (
            "host",
            "foreign.example",
            StatusCode::FORBIDDEN,
            "foreign_origin",
        ),
    ] {
        let mut message = request(&server, "POST", "/api/v1/imports", Some(input.clone()));
        message
            .headers_mut()
            .insert(header, supplied.parse().unwrap());
        let response = server.router().oneshot(message).await.unwrap();
        assert_eq!(response.status(), status);
        assert_eq!(value(response).await["code"], code);
    }
    assert_eq!(
        call(&server, "GET", &format!("/api/v1/requests/{id}"), None)
            .await
            .1["code"],
        "unknown_request"
    );
    for body in [
        json!({"request_id":id,"source_path":"relative"}),
        json!({"request_id":"bad","source_path":root.path()}),
        json!({"request_id":id,"source_path":root.path(),"unexpected":true}),
    ] {
        assert_eq!(
            call(&server, "POST", "/api/v1/imports", Some(body)).await.0,
            StatusCode::BAD_REQUEST
        );
    }
    let malformed = Request::builder()
        .method("POST")
        .uri("/api/v1/imports")
        .header("authorization", format!("Bearer {TOKEN}"))
        .header("x-locus-run", server.ready().run_id)
        .header("content-type", "application/json")
        .body(Body::from("{"))
        .unwrap();
    assert_eq!(
        value(server.router().oneshot(malformed).await.unwrap()).await["code"],
        "invalid_request"
    );
    assert_eq!(
        call(&server, "GET", "/unknown", None).await.1["code"],
        "not_found"
    );
    assert_eq!(
        call(&server, "DELETE", "/api/v1/server", None).await.1["code"],
        "method_not_allowed"
    );
    assert_eq!(
        call(&server, "GET", "/api/v1/files/not-a-uuid", None)
            .await
            .1["code"],
        "invalid_request"
    );
    assert_eq!(
        call(
            &server,
            "GET",
            &format!("/api/v1/files/{}", uuid::Uuid::now_v7()),
            None
        )
        .await
        .1["code"],
        "missing_file"
    );
    assert!(
        call(&server, "GET", "/api/v1/tasks", None).await.1["tasks"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn lost_response_snapshot_first_reconnect_slow_consumer_and_restart_keep_truthful_outcomes() {
    let (root, server) = app().await;
    let original = root.path().join("original.bin");
    std::fs::write(&original, vec![0x5a; 2 * 1024 * 1024]).unwrap();
    let mut events = server
        .router()
        .oneshot(request(&server, "GET", "/api/v1/events", None))
        .await
        .unwrap()
        .into_body();
    assert!(
        event(&mut events).await["tasks"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let request_id = uuid::Uuid::now_v7().to_string();
    let input = json!({"request_id": request_id,"source_path":original});
    // Lose the actual response body, while the server owns the accepted import.
    drop(
        server
            .router()
            .oneshot(request(
                &server,
                "POST",
                "/api/v1/imports",
                Some(input.clone()),
            ))
            .await
            .unwrap(),
    );
    let (_, recovered) = call(
        &server,
        "GET",
        &format!("/api/v1/requests/{request_id}"),
        None,
    )
    .await;
    let receipt = recovered["receipt"].clone();
    let task_id = receipt["task_id"].as_str().unwrap();
    assert_eq!(
        call(&server, "POST", "/api/v1/imports", Some(input))
            .await
            .1,
        receipt
    );
    // Deliberately leave the original event body unpolled through completion.
    let outcome = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let (_, task) = call(&server, "GET", &format!("/api/v1/tasks/{task_id}"), None).await;
            if task["state"] == "terminal" {
                let (_, outcome) = call(
                    &server,
                    "GET",
                    &format!("/api/v1/tasks/{task_id}/outcome"),
                    None,
                )
                .await;
                assert_eq!(outcome["status"], "complete");
                return outcome;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let slow = event(&mut events).await;
    assert_eq!(slow["tasks"][0]["state"], "terminal");
    let mut reconnected = server
        .router()
        .oneshot(request(&server, "GET", "/api/v1/events", None))
        .await
        .unwrap()
        .into_body();
    let latest = event(&mut reconnected).await;
    assert_eq!(latest["tasks"][0]["state"], "terminal");
    assert!(
        latest["revision"].as_str().unwrap().parse::<u64>().unwrap()
            >= slow["revision"].as_str().unwrap().parse::<u64>().unwrap()
    );
    let file = &outcome["outcome"]["file"];
    let file_id = file["file_id"].as_str().unwrap();
    assert_eq!(
        call(&server, "GET", &format!("/api/v1/files/{file_id}"), None)
            .await
            .1,
        *file
    );
    assert_eq!(std::fs::metadata(&original).unwrap().len(), 2 * 1024 * 1024);
    let failed = call(&server,"POST","/api/v1/imports",Some(json!({"request_id":uuid::Uuid::now_v7().to_string(),"source_path":root.path().join("missing")}))).await.1;
    let failed_id = failed["task_id"].as_str().unwrap();
    loop {
        let (_, outcome) = call(
            &server,
            "GET",
            &format!("/api/v1/tasks/{failed_id}/outcome"),
            None,
        )
        .await;
        if outcome["status"] == "complete" {
            assert_eq!(outcome["outcome"]["status"], "failed");
            assert_eq!(outcome["outcome"]["diagnostic"]["kind"], "input_missing");
            assert!(outcome["outcome"]["progress"]["file_id"].is_string());
            break;
        }
        tokio::task::yield_now().await;
    }
    server.close_admission();
    assert_eq!(
        call(&server, "POST", "/api/v1/drain", None).await.1["admission"],
        "drained"
    );
    assert_eq!(
        call(&server, "POST", "/api/v1/drain", None).await.1["admission"],
        "drained"
    );
    drop(events);
    drop(reconnected);
    let old_run = server.ready().run_id;
    drop(server);
    let restarted = Server::bind(ServerConfig::new(TOKEN.into(), root.path().join("library")))
        .await
        .unwrap();
    assert_ne!(restarted.ready().run_id, old_run);
    assert_eq!(
        call(&restarted, "GET", &format!("/api/v1/files/{file_id}"), None)
            .await
            .1,
        *file
    );
    assert_eq!(
        call(&restarted, "GET", &format!("/api/v1/tasks/{task_id}"), None)
            .await
            .1["code"],
        "unknown_task"
    );
    let mut stale = request(&restarted, "GET", "/api/v1/tasks", None);
    stale
        .headers_mut()
        .insert("x-locus-run", old_run.parse().unwrap());
    assert_eq!(
        server_response(&restarted, stale).await,
        StatusCode::CONFLICT
    );
}
async fn server_response(server: &Server, request: Request<Body>) -> StatusCode {
    server.router().oneshot(request).await.unwrap().status()
}

#[tokio::test(flavor = "multi_thread")]
async fn paused_sse_delivers_latest_terminal_projection_before_drain_eof() {
    let (root, server) = app().await;
    let source = root.path().join("source");
    std::fs::write(&source, b"latest replacement").unwrap();
    let mut events = server
        .router()
        .oneshot(request(&server, "GET", "/api/v1/events", None))
        .await
        .unwrap()
        .into_body();
    assert!(
        event(&mut events).await["tasks"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    for _ in 0..2 {
        let receipt = call(
            &server,
            "POST",
            "/api/v1/imports",
            Some(json!({"request_id":uuid::Uuid::now_v7().to_string(),"source_path":source})),
        )
        .await
        .1;
        let id = receipt["task_id"].as_str().unwrap();
        loop {
            if call(&server, "GET", &format!("/api/v1/tasks/{id}/outcome"), None)
                .await
                .1["status"]
                == "complete"
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    }
    // The body remains suspended after its old snapshot across both completions
    // and drain. It must send the replacement, rather than checking a live close
    // flag and silently ending before the observer can see the final state.
    server.close_admission();
    let latest = event(&mut events).await;
    assert_eq!(latest["tasks"].as_array().unwrap().len(), 2);
    for task in latest["tasks"].as_array().unwrap() {
        assert_eq!(task["state"], "terminal");
        assert_eq!(task["outcome_available"], true);
    }
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(2), events.frame())
            .await
            .unwrap()
            .is_none()
    );
}

#[test]
fn schema_is_deterministic_and_describes_every_business_route_and_stream() {
    let one = locus_server::api::openapi().unwrap().to_json().unwrap();
    assert_eq!(
        one,
        locus_server::api::openapi().unwrap().to_json().unwrap()
    );
    let schema: Value = serde_json::from_str(&one).unwrap();
    assert_eq!(schema["paths"].as_object().unwrap().len(), 47);
    for (path, methods, tag) in [
        ("/api/v1/models/{component_id}", &["get"][..], "model"),
        ("/api/v1/models/{component_id}/view", &["get"][..], "model"),
        ("/api/v1/settings/definitions", &["get"][..], "settings"),
        ("/api/v1/settings/media-runtime", &["get"][..], "settings"),
        (
            "/api/v1/settings/groups/{group_id}",
            &["get", "post"][..],
            "settings",
        ),
        (
            "/api/v1/twitter/{component_id}/view",
            &["get"][..],
            "twitter",
        ),
        (
            "/api/v1/entities/{entity_id}/view-preference",
            &["get", "put"][..],
            "preferences",
        ),
        (
            "/api/v1/entities/view-preferences/batch",
            &["post"][..],
            "preferences",
        ),
        ("/api/v1/import-batches", &["get", "post"][..], "imports"),
        ("/api/v1/import-recoveries", &["post"][..], "imports"),
    ] {
        for method in methods {
            assert_eq!(schema["paths"][path][method]["tags"], json!([tag]));
        }
    }
    assert_eq!(
        schema["components"]["schemas"]["SavedViewPreference"]["properties"]["revision"]["type"],
        "string"
    );
    assert_eq!(
        schema["paths"]["/api/v1/events"]["get"]["responses"]["200"]["content"]["text/event-stream"]
            ["schema"]["type"],
        "string"
    );
    assert_eq!(
        schema["components"]["schemas"]["FileMetadata"]["properties"]["byte_count"]["type"],
        "string"
    );
    let mut operation_ids = std::collections::BTreeSet::new();
    for (name, path) in schema["paths"].as_object().unwrap() {
        for (method, operation) in path.as_object().unwrap() {
            assert!(
                operation_ids.insert(operation["operationId"].as_str().unwrap()),
                "duplicate operation ID"
            );
            if name == "/external/v1/bootstrap" || method == "options" {
                assert_eq!(operation["security"], json!([]));
                assert!(
                    operation["parameters"].is_null()
                        || operation["parameters"].as_array().unwrap().is_empty()
                );
                continue;
            }
            assert!(operation["responses"]["401"].is_object());
            assert!(
                operation["parameters"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|parameter| parameter["name"] == "X-Locus-Run"
                        && parameter["required"] == true)
            );
        }
    }
    assert!(schema["security"][0]["bearer"].is_array());
    assert_eq!(
        schema["components"]["securitySchemes"]
            .as_object()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn bootstrap_rejects_invalid_bounded_inputs_without_echoing_credentials() {
    use locus_server::api::Bootstrap;
    for bytes in [
        vec![b'x'; 16385],
        br#"{"credential":"secret"}"#.to_vec(),
        br#"{"credential":"secret","unexpected":true}"#.to_vec(),
    ] {
        let error = Bootstrap::read(bytes.as_slice()).err().unwrap();
        assert!(!format!("{error:#}").contains("secret"));
    }
}
