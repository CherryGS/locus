#![allow(clippy::expect_used, clippy::unwrap_used)]
#[path = "../examples/twitter-fixture/mod.rs"]
mod fixture;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use locus_server::api::{Server, ServerConfig};
use serde_json::Value;
use tower::ServiceExt;
const TOKEN: &str = "twitter-http-test-credential-32-characters";
async fn read(server: &Server, id: &str, token: &str, run: &str) -> (StatusCode, Value) {
    let response = server
        .router()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/twitter/{id}/view"))
                .header("authorization", format!("Bearer {token}"))
                .header("x-locus-run", run)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    (
        response.status(),
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap(),
    )
}
#[tokio::test(flavor = "multi_thread")]
async fn retained_provider_reads_preserve_all_roles_and_failures_after_reopen() {
    let root = tempfile::tempdir().unwrap();
    let library = root.path().join("library");
    let seeded = fixture::seed(&library, None).await.unwrap();
    let server = Server::bind(ServerConfig::new(TOKEN.into(), library.clone()))
        .await
        .unwrap();
    let run = server.ready().run_id;
    for entry in seeded["entries"].as_array().unwrap() {
        let name = entry["name"].as_str().unwrap();
        let (status, value) =
            read(&server, entry["componentId"].as_str().unwrap(), TOKEN, &run).await;
        if ["corrupt", "missing-record", "future-version"].contains(&name) {
            assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
            assert_eq!(value["diagnostic"]["owner"], "twitter");
            assert_eq!(
                value["diagnostic"]["error"]["code"],
                match name {
                    "corrupt" => "corrupt",
                    "missing-record" => "missing_record",
                    _ => "payload_version",
                }
            );
            if name == "future-version" {
                assert_eq!(value["diagnostic"]["error"]["version"], 99);
            }
            continue;
        }
        assert_eq!(status, StatusCode::OK, "{name}: {value}");
        assert_eq!(value["record"]["component_id"], entry["componentId"]);
        let snapshot = &value["record"]["snapshot"];
        if name == "complete" {
            assert_eq!(snapshot["published_at_unix_ms"], "0");
            assert_eq!(snapshot["occurrence"]["source_order"], 0);
            assert_eq!(snapshot["occurrence"]["claims"]["duration_ms"], "0");
            assert_eq!(
                snapshot["representation"]["claims"]["duration_ms"],
                "9007199254740993"
            );
            assert_eq!(
                snapshot["representation"]["claims"]["bitrate_bps"],
                "9223372036854775807"
            );
            assert_ne!(snapshot["requested_url"], snapshot["page_url"]);
            assert_eq!(snapshot["references"][0]["kind"], "reply_to");
            assert_eq!(
                snapshot["preview"]["description"],
                "Remote preview claim only"
            );
            assert_eq!(value["applicability"]["comparison"]["status"], "matching");
        }
        if name == "partial-empty" {
            assert_eq!(snapshot["text"], "");
            assert_eq!(snapshot["references"], serde_json::json!([]));
            assert_eq!(snapshot["observed_at_unix_ms"], "0");
        }
        if name == "locator-only" {
            assert!(snapshot["text"].is_null());
            assert!(snapshot["author"].is_null());
            assert!(snapshot["references"].is_null());
            assert!(value["record"]["basis"].is_null());
        }
        if name == "changed-association" {
            assert_eq!(value["applicability"]["comparison"]["status"], "changed");
            assert!(snapshot["text"].is_string());
        }
        if name == "producer-issue" {
            assert_eq!(snapshot["issues"][0]["portion"], "selected_representation");
        }
        if name == "matching-file-error" {
            assert_eq!(value["applicability"]["comparison"]["status"], "matching");
            assert!(value["applicability"]["file_error"]["message"].is_string());
        }
        if name == "missing-input" {
            assert_eq!(
                value["applicability"]["comparison"]["current"]["status"],
                "missing_slot"
            );
        }
        if name == "unmounted" {
            assert_eq!(value["applicability"]["status"], "unmounted");
        } else {
            assert_eq!(value["applicability"]["host"], entry["entityId"]);
        }
    }
    let id = seeded["entries"][0]["componentId"].as_str().unwrap();
    assert_eq!(
        read(&server, id, "wrong", &run).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        read(&server, id, TOKEN, "wrong-run").await.0,
        StatusCode::CONFLICT
    );
    for invalid in [
        "invalid",
        "00000000-0000-4000-8000-000000000000",
        &id.to_uppercase(),
        &id.replace('-', ""),
    ] {
        assert_eq!(
            read(&server, invalid, TOKEN, &run).await.0,
            StatusCode::BAD_REQUEST
        );
    }
    let mut session = locus_store::api::Session::open(library.join("metadata.sqlite"))
        .await
        .unwrap();
    session
        .transaction::<_, locus_store::api::StoreError, _>(|c| {
            Box::pin(async move {
                use diesel_async::SimpleAsyncConnection;
                c.connection()
                    .batch_execute("DROP TABLE locus_core_rela_membership")
                    .await?;
                Ok(())
            })
        })
        .await
        .unwrap();
    let (status, value) = read(&server, id, TOKEN, &run).await;
    assert_eq!(status, StatusCode::OK);
    assert!(value["record"]["snapshot"]["text"].is_string());
    assert_eq!(value["applicability"]["status"], "error");
}
