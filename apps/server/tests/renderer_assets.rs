#![allow(clippy::expect_used, clippy::unwrap_used)]

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use locus_server::api::{Server, ServerConfig};
use tower::ServiceExt;

const TOKEN: &str = "renderer-fixture-credential-at-least-thirty-two";
async fn fixture() -> (tempfile::TempDir, Server) {
    let root = tempfile::tempdir().unwrap();
    let renderer = root.path().join("renderer");
    std::fs::create_dir_all(renderer.join("assets")).unwrap();
    std::fs::write(renderer.join("index.html"), "<html>fixture</html>").unwrap();
    std::fs::write(
        renderer.join("assets/app.js"),
        "export const fixture = true;",
    )
    .unwrap();
    std::fs::write(renderer.join("assets/font.woff2"), b"font").unwrap();
    std::fs::write(root.path().join("secret.js"), "secret").unwrap();
    let mut config = ServerConfig::new(TOKEN.into(), root.path().join("library"));
    config.renderer_root = Some(renderer);
    (root, Server::bind(config).await.unwrap())
}
fn request(server: &Server, method: &str, path: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(path)
        .header("authorization", format!("Bearer {TOKEN}"))
        .header("x-locus-run", server.ready().run_id)
        .body(Body::empty())
        .unwrap()
}
#[tokio::test(flavor = "multi_thread")]
async fn renderer_assets_are_authorized_typed_and_separate_from_api_and_library() {
    let (_root, server) = fixture().await;
    for (path, mime) in [
        ("/", "text/html; charset=utf-8"),
        ("/index.html", "text/html; charset=utf-8"),
        ("/assets/app.js", "text/javascript; charset=utf-8"),
        ("/assets/font.woff2", "font/woff2"),
    ] {
        let response = server
            .router()
            .oneshot(request(&server, "GET", path))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["content-type"], mime);
        assert_eq!(response.headers()["x-content-type-options"], "nosniff");
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert!(
            response.headers()["content-security-policy"]
                .to_str()
                .unwrap()
                .contains("frame-src 'none'")
        );
        let length = response.headers()["content-length"]
            .to_str()
            .unwrap()
            .parse::<usize>()
            .unwrap();
        assert_eq!(
            response
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes()
                .len(),
            length
        );
        let head = server
            .router()
            .oneshot(request(&server, "HEAD", path))
            .await
            .unwrap();
        assert_eq!(head.headers()["content-length"], length.to_string());
        assert!(
            head.into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes()
                .is_empty()
        );
        let mut unauthorized = request(&server, "GET", path);
        unauthorized.headers_mut().remove("authorization");
        assert_eq!(
            server
                .router()
                .oneshot(unauthorized)
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        let mut wrong = request(&server, "GET", path);
        wrong
            .headers_mut()
            .insert("x-locus-run", "old-run".parse().unwrap());
        assert_eq!(
            server.router().oneshot(wrong).await.unwrap().status(),
            StatusCode::CONFLICT
        );
    }
    for path in [
        "/assets/../secret.js",
        "/assets/%2e%2e/secret.js",
        "/assets/..%5csecret.js",
        "/assets/%2fsecret.js",
        "/metadata.sqlite",
        "/object/secret",
        "/assets/missing.js",
        "/api/v1/not-an-api",
    ] {
        let response = server
            .router()
            .oneshot(request(&server, "GET", path))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
        assert_ne!(
            response.headers()["content-type"],
            "text/html; charset=utf-8"
        );
    }
}
#[tokio::test(flavor = "multi_thread")]
async fn renderer_configuration_is_optional_and_missing_builds_fail_startup() {
    let root = tempfile::tempdir().unwrap();
    let server = Server::bind(ServerConfig::new(
        TOKEN.into(),
        root.path().join("api-library"),
    ))
    .await
    .unwrap();
    assert_eq!(
        server
            .router()
            .oneshot(request(&server, "GET", "/"))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    let mut config = ServerConfig::new(TOKEN.into(), root.path().join("missing-library"));
    config.renderer_root = Some(root.path().join("absent-build"));
    assert!(Server::bind(config).await.is_err());
}
