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

const TOKEN: &str = "media-test-credential-at-least-32-characters";
async fn app() -> (tempfile::TempDir, Server) {
    let root = tempfile::tempdir().unwrap();
    let server = Server::bind(ServerConfig::new(TOKEN.into(), root.path().join("library")))
        .await
        .unwrap();
    (root, server)
}
fn request(server: &Server, method: &str, path: &str, body: Option<Value>) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(path)
        .header("authorization", format!("Bearer {TOKEN}"))
        .header("x-locus-run", server.ready().run_id)
        .header("content-type", "application/json")
        .body(Body::from(body.map(|b| b.to_string()).unwrap_or_default()))
        .unwrap()
}
async fn response(server: &Server, method: &str, path: &str, body: Option<Value>) -> Response {
    server
        .router()
        .oneshot(request(server, method, path, body))
        .await
        .unwrap()
}
async fn call(server: &Server, method: &str, path: &str, body: Option<Value>) -> Value {
    let result = response(server, method, path, body).await;
    assert_eq!(
        result.status(),
        if path == "/api/v1/imports"
            || path == "/api/v1/interpretations"
            || path == "/api/v1/previews"
        {
            StatusCode::ACCEPTED
        } else {
            StatusCode::OK
        }
    );
    serde_json::from_slice(&result.into_body().collect().await.unwrap().to_bytes()).unwrap()
}
fn id() -> String {
    uuid::Uuid::now_v7().to_string()
}
async fn post(server: &Server, path: &str, mut value: Value) -> Value {
    value["request_id"] = json!(id());
    call(server, "POST", path, Some(value)).await
}
async fn completed(server: &Server, receipt: &Value) -> Value {
    tokio::time::timeout(std::time::Duration::from_secs(15), async {
        loop {
            let value = call(
                server,
                "GET",
                &format!(
                    "/api/v1/tasks/{}/outcome",
                    receipt["task_id"].as_str().unwrap()
                ),
                None,
            )
            .await;
            if value["status"] == "complete" {
                return value["outcome"].clone();
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap()
}
async fn import(server: &Server, path: &std::path::Path) -> Value {
    completed(
        server,
        &post(server, "/api/v1/imports", json!({"source_path":path})).await,
    )
    .await["file"]
        .clone()
}
async fn entity(server: &Server) -> String {
    post(server, "/api/v1/entities", json!({})).await["entity_id"]
        .as_str()
        .unwrap()
        .into()
}
async fn component(server: &Server, kind: &str) -> Value {
    post(server, "/api/v1/media", json!({"kind":kind})).await
}
fn membership(entity: &str, kind: &str, component: &str) -> Value {
    json!({"entity_id":entity,"kind_id":kind,"component_id":component})
}
async fn attach(server: &Server, m: &Value) -> Value {
    post(
        server,
        "/api/v1/memberships/attach",
        json!({"membership":m}),
    )
    .await
}
async fn interpret(server: &Server, t: &Value) -> Value {
    completed(
        server,
        &post(server, "/api/v1/interpretations", json!({"target":t})).await,
    )
    .await
}
async fn preview(server: &Server, t: &Value) -> Value {
    completed(
        server,
        &post(server, "/api/v1/previews", json!({"target":t,"edge":16})).await,
    )
    .await
}
fn media_path(t: &Value) -> String {
    format!(
        "/api/v1/media/{}/{}",
        t["kind"].as_str().unwrap(),
        t["component_id"].as_str().unwrap()
    )
}

#[tokio::test(flavor = "multi_thread")]
async fn image_sequence_truthful_views_cache_evidence_and_bytes() {
    let (root, server) = app().await;
    let source = root.path().join("input.png");
    image::RgbaImage::new(32, 20).save(&source).unwrap();
    let file = import(&server, &source).await;
    let entity = entity(&server).await;
    let image = component(&server, "image").await;
    let target = &image["target"];
    let record = call(&server, "GET", &media_path(target), None).await;
    assert!(record["facts"].is_null());
    assert_eq!(record["revision"], "0");
    let view = call(
        &server,
        "GET",
        &format!("{}/view", media_path(target)),
        None,
    )
    .await;
    assert_eq!(view["applicability"]["status"], "unmounted");
    let warning = interpret(&server, target).await;
    assert_eq!(warning["status"], "interpreted");
    assert_eq!(
        warning["result"]["record"]["last_failure"]["code"],
        "missing_input"
    );
    let fm = membership(
        &entity,
        &locus_file::api::FILE_KIND.to_string(),
        file["file_id"].as_str().unwrap(),
    );
    let mm = membership(
        &entity,
        image["kind_id"].as_str().unwrap(),
        target["component_id"].as_str().unwrap(),
    );
    assert_eq!(attach(&server, &fm).await["status"], "attached");
    assert_eq!(attach(&server, &mm).await["status"], "attached");
    assert_eq!(attach(&server, &mm).await["status"], "already_attached");
    let good = interpret(&server, target).await;
    assert_eq!(good["result"]["status"], "accepted");
    assert!(good["result"]["record"]["last_failure"].is_null());
    assert_eq!(good["result"]["record"]["facts"]["width"], 32);
    let p = preview(&server, target).await;
    assert_eq!(p["preview"]["origin"], "generated");
    assert_eq!(preview(&server, target).await["preview"]["origin"], "hit");
    let path = format!(
        "/api/v1/previews/{}/bytes",
        p["preview"]["locator"].as_str().unwrap()
    );
    let png = response(&server, "GET", &path, None).await;
    assert_eq!(png.headers()["content-type"], "image/png");
    assert_eq!(png.headers()["x-content-type-options"], "nosniff");
    let length = png.headers()["content-length"]
        .to_str()
        .unwrap()
        .parse::<usize>()
        .unwrap();
    let bytes = png.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(length, bytes.len());
    assert_eq!(image::load_from_memory(&bytes).unwrap().width(), 16);
    let head = response(&server, "HEAD", &path, None).await;
    assert_eq!(head.headers()["content-length"], length.to_string());
    assert!(
        head.into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .is_empty()
    );
    let original_path = format!("/api/v1/files/{}/bytes", file["file_id"].as_str().unwrap());
    let mut range = request(&server, "GET", &original_path, None);
    range
        .headers_mut()
        .insert("range", "bytes=0-1".parse().unwrap());
    let original = server.router().oneshot(range).await.unwrap();
    assert_eq!(original.status(), StatusCode::OK);
    assert_eq!(
        original.headers()["content-type"],
        "application/octet-stream"
    );
    assert_eq!(original.headers()["content-disposition"], "attachment");
    assert_eq!(original.headers()["cache-control"], "no-store");
    assert_eq!(
        original.into_body().collect().await.unwrap().to_bytes(),
        std::fs::read(&source).unwrap()
    );
    // Leave byte transfer entirely unpolled; another real DB mutation still ends.
    let held = response(&server, "GET", &original_path, None).await;
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        post(&server, "/api/v1/entities", json!({})),
    )
    .await
    .unwrap();
    drop(held);
    // Replacement input changes applicability without relabeling prior evidence.
    post(
        &server,
        "/api/v1/memberships/detach",
        json!({"membership":fm}),
    )
    .await;
    let invalid = root.path().join("unsupported");
    std::fs::write(&invalid, b"unsupported").unwrap();
    let replacement = import(&server, &invalid).await;
    attach(
        &server,
        &membership(
            &entity,
            &locus_file::api::FILE_KIND.to_string(),
            replacement["file_id"].as_str().unwrap(),
        ),
    )
    .await;
    let v = call(
        &server,
        "GET",
        &format!("{}/view", media_path(target)),
        None,
    )
    .await;
    assert_eq!(v["applicability"]["status"], "changed");
    assert_eq!(v["record"]["basis"], file["file_id"]);
    assert_eq!(
        response(&server, "GET", &path, None).await.status(),
        StatusCode::OK
    );
    assert_eq!(p["preview"]["file_id"], file["file_id"]);
    assert_eq!(preview(&server, target).await["status"], "media_failed");
    let failed = interpret(&server, target).await;
    assert_eq!(failed["result"]["record"]["basis"], file["file_id"]);
    assert_eq!(
        failed["result"]["record"]["last_failure"]["code"],
        "unsupported_input"
    );
    // Cache eviction invalidates access without undoing results or regenerating.
    for item in std::fs::read_dir(root.path().join("library/media-cache-v1")).unwrap() {
        let path = item.unwrap().path();
        if path.extension().is_some_and(|e| e == "png") {
            std::fs::remove_file(path).unwrap();
        }
    }
    let missing = response(&server, "GET", &path, None).await;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    assert!(
        !std::fs::read_dir(root.path().join("library/media-cache-v1"))
            .unwrap()
            .any(|p| p.unwrap().path().extension().is_some_and(|e| e == "png"))
    );
    std::fs::remove_file(
        root.path()
            .join("library")
            .join(file["relative_path"].as_str().unwrap()),
    )
    .unwrap();
    assert_eq!(
        response(&server, "GET", &original_path, None)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(
            &server,
            "GET",
            &format!("/api/v1/files/{}", file["file_id"].as_str().unwrap()),
            None
        )
        .await,
        file
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn recoverable_creation_membership_conflicts_and_independent_kinds() {
    let (_root, server) = app().await;
    let request_id = id();
    let body = json!({"request_id":request_id});
    let (a, b) = tokio::join!(
        call(&server, "POST", "/api/v1/entities", Some(body.clone())),
        call(&server, "POST", "/api/v1/entities", Some(body.clone()))
    );
    assert_eq!(a, b);
    assert_eq!(
        call(
            &server,
            "GET",
            &format!("/api/v1/requests/{request_id}"),
            None
        )
        .await["outcome"],
        a
    );
    let conflict = response(
        &server,
        "POST",
        "/api/v1/media",
        Some(json!({"request_id":request_id,"kind":"image"})),
    )
    .await;
    assert_eq!(conflict.status(), StatusCode::CONFLICT);
    let entity = a["entity_id"].as_str().unwrap();
    let image = component(&server, "image").await;
    let video = component(&server, "video").await;
    let m = membership(
        entity,
        image["kind_id"].as_str().unwrap(),
        image["target"]["component_id"].as_str().unwrap(),
    );
    attach(&server, &m).await;
    attach(
        &server,
        &membership(
            entity,
            video["kind_id"].as_str().unwrap(),
            video["target"]["component_id"].as_str().unwrap(),
        ),
    )
    .await;
    let entries = call(
        &server,
        "GET",
        &format!("/api/v1/entities/{entity}/media"),
        None,
    )
    .await;
    assert_eq!(entries.as_array().unwrap().len(), 2);
    for entry in entries.as_array().unwrap() {
        assert_eq!(entry["result"]["status"], "readable");
        assert!(entry["result"]["view"]["record"]["facts"].is_null());
        assert_eq!(
            entry["result"]["view"]["applicability"]["current"]["status"],
            "missing_slot"
        );
    }
    let other = component(&server, "image").await;
    let occupied = attach(
        &server,
        &membership(
            entity,
            other["kind_id"].as_str().unwrap(),
            other["target"]["component_id"].as_str().unwrap(),
        ),
    )
    .await;
    assert_eq!(occupied["diagnostic"]["error"]["code"], "slot_occupied");
    let other_entity = post(&server, "/api/v1/entities", json!({})).await;
    let occupied = attach(
        &server,
        &membership(
            other_entity["entity_id"].as_str().unwrap(),
            image["kind_id"].as_str().unwrap(),
            image["target"]["component_id"].as_str().unwrap(),
        ),
    )
    .await;
    assert_eq!(
        occupied["diagnostic"]["error"]["code"],
        "attachment_occupied"
    );
    let stale = membership(
        entity,
        image["kind_id"].as_str().unwrap(),
        other["target"]["component_id"].as_str().unwrap(),
    );
    assert_eq!(
        post(
            &server,
            "/api/v1/memberships/detach",
            json!({"membership":stale})
        )
        .await["removed"],
        false
    );
    let missing = attach(
        &server,
        &membership(
            &id(),
            image["kind_id"].as_str().unwrap(),
            image["target"]["component_id"].as_str().unwrap(),
        ),
    )
    .await;
    assert_eq!(missing["diagnostic"]["error"]["code"], "missing_entity");
    let mismatch = attach(
        &server,
        &membership(
            other_entity["entity_id"].as_str().unwrap(),
            video["kind_id"].as_str().unwrap(),
            image["target"]["component_id"].as_str().unwrap(),
        ),
    )
    .await;
    assert_eq!(mismatch["diagnostic"]["error"]["code"], "kind_mismatch");
    assert!(
        call(&server, "GET", "/api/v1/tasks", None).await["tasks"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    server.close_admission();
    assert_eq!(
        call(&server, "POST", "/api/v1/entities", Some(body)).await,
        a
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn byte_auth_zero_length_unknown_and_wrong_run() {
    let (root, server) = app().await;
    let source = root.path().join("empty");
    std::fs::write(&source, b"").unwrap();
    let file = import(&server, &source).await;
    let path = format!("/api/v1/files/{}/bytes", file["file_id"].as_str().unwrap());
    for method in ["GET", "HEAD"] {
        let r = response(&server, method, &path, None).await;
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(r.headers()["content-length"], "0");
        assert!(r.into_body().collect().await.unwrap().to_bytes().is_empty());
    }
    for p in [path, format!("/api/v1/previews/{}/bytes", id())] {
        let mut r = request(&server, "GET", &p, None);
        r.headers_mut().remove("authorization");
        assert_eq!(
            server.router().oneshot(r).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
        let mut r = request(&server, "GET", &p, None);
        r.headers_mut().insert("x-locus-run", id().parse().unwrap());
        assert_eq!(
            server.router().oneshot(r).await.unwrap().status(),
            StatusCode::CONFLICT
        );
    }
    assert_eq!(
        response(
            &server,
            "GET",
            &format!("/api/v1/previews/{}/bytes", id()),
            None
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        response(
            &server,
            "GET",
            &format!("/api/v1/files/{}/bytes", id()),
            None
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn original_truncated_after_open_fails_http_body_instead_of_empty_success() {
    let (root, server) = app().await;
    let source = root.path().join("truncated-original");
    std::fs::write(&source, b"original remains").unwrap();
    let file = import(&server, &source).await;
    let path = format!("/api/v1/files/{}/bytes", file["file_id"].as_str().unwrap());
    let result = response(&server, "GET", &path, None).await;
    assert_eq!(result.headers()["content-length"], "16");
    let managed = root
        .path()
        .join("library")
        .join(file["relative_path"].as_str().unwrap());
    std::fs::OpenOptions::new()
        .write(true)
        .open(managed)
        .unwrap()
        .set_len(0)
        .unwrap();
    assert!(result.into_body().collect().await.is_err());
    assert_eq!(std::fs::read(source).unwrap(), b"original remains");
}
