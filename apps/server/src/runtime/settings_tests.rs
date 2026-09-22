use super::{Server, ServerConfig};
use crate::api::{
    dto::{AdmissionState, MutationOutcome, Submission},
    settings::dto::*,
};
use axum::{body::Body, http::Request};
use diesel_async::SimpleAsyncConnection;
use locus_media::api::MEDIA_TOOL_PATHS;
use serde_json::{Value, json};
use tower::ServiceExt;
async fn app() -> (tempfile::TempDir, Server) {
    let root = tempfile::tempdir().unwrap();
    let server = Server::bind(ServerConfig::new(
        "settings-test-credential-at-least-32-characters".into(),
        root.path().join("library"),
    ))
    .await
    .unwrap();
    (root, server)
}
async fn http(
    server: &Server,
    method: &str,
    path: &str,
    body: Value,
    auth: bool,
    run: Option<&str>,
) -> (u16, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json");
    if auth {
        request = request.header(
            "authorization",
            format!("Bearer {}", server.state.credential),
        );
    }
    request = request.header("x-locus-run", run.unwrap_or(&server.state.run_id));
    let response = server
        .router()
        .oneshot(
            request
                .body(Body::from(serde_json::to_vec(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status().as_u16();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}
#[tokio::test(flavor = "multi_thread")]
async fn http_settings_auth_guards_recovery_invalid_metadata_and_saved_runtime_separation() {
    let (_root, server) = app().await;
    let path = format!("/api/v1/settings/groups/{MEDIA_TOOL_PATHS}");
    assert_eq!(
        http(&server, "GET", &path, Value::Null, false, None)
            .await
            .0,
        401
    );
    assert_eq!(
        http(
            &server,
            "GET",
            &path,
            Value::Null,
            true,
            Some("another-run")
        )
        .await
        .0,
        409
    );
    let (status, first) = http(&server, "GET", &path, Value::Null, true, None).await;
    assert_eq!(status, 200);
    assert_eq!(first["status"], "current");
    let revision = first["saved"]["metadata"]["revision"].as_str().unwrap();
    let request = uuid::Uuid::now_v7().to_string();
    let body = json!({"request_id":request,"change":{"operation":"update","expected_revision":revision,"value":{"ffprobe":"saved-probe","ffmpeg":"saved-encoder"}}});
    let before = http(
        &server,
        "GET",
        "/api/v1/settings/media-runtime",
        Value::Null,
        true,
        None,
    )
    .await
    .1;
    let saved = http(&server, "POST", &path, body.clone(), true, None).await;
    assert_eq!(saved.1["status"], "settings_saved");
    assert_eq!(
        http(&server, "POST", &path, body.clone(), true, None).await,
        saved
    );
    assert_eq!(
        http(
            &server,
            "GET",
            "/api/v1/settings/media-runtime",
            Value::Null,
            true,
            None
        )
        .await
        .1,
        before
    );
    assert_eq!(
        http(
            &server,
            "GET",
            &format!("/api/v1/requests/{request}"),
            Value::Null,
            true,
            None
        )
        .await
        .1["outcome"],
        saved.1
    );
    let mut stale = body.clone();
    stale["request_id"] = json!(uuid::Uuid::now_v7().to_string());
    assert_eq!(
        http(&server, "POST", &path, stale, true, None).await.1["status"],
        "settings_conflict"
    );
    let mut bad = body;
    bad["request_id"] = json!(uuid::Uuid::now_v7().to_string());
    bad["change"]["expected_revision"] = saved.1["saved"]["metadata"]["revision"].clone();
    bad["change"]["value"]["ffprobe"] = json!("");
    assert_eq!(
        http(&server, "POST", &path, bad, true, None).await.1["diagnostic"]["error"]["code"],
        "invalid"
    );
    let domain = server.state.domain.clone();
    server
        .state
        .query("corrupt fixture", move |task| async move {
            let mut session = domain.database.session(&task).await.unwrap();
            session
                .transaction::<_, locus_store::api::StoreError, _>(|ctx| {
                    Box::pin(async move {
                        ctx.connection()
                            .batch_execute("UPDATE locus_settings_values SET payload='{' ")
                            .await?;
                        Ok(())
                    })
                })
                .await
                .unwrap();
            Ok(())
        })
        .await
        .unwrap();
    let broken = http(&server, "GET", &path, Value::Null, true, None).await.1;
    assert_eq!(broken["status"], "invalid");
    assert_eq!(broken["metadata"], saved.1["saved"]["metadata"]);
    assert_eq!(
        http(
            &server,
            "GET",
            "/api/v1/settings/media-runtime",
            Value::Null,
            true,
            None
        )
        .await
        .1,
        before
    );
    let domain = server.state.domain.clone();
    server
        .state
        .query("large version fixture", move |task| async move {
            let mut session = domain.database.session(&task).await.unwrap();
            session
                .transaction::<_, locus_store::api::StoreError, _>(|ctx| {
                    Box::pin(async move {
                        ctx.connection()
                            .batch_execute(
                                "UPDATE locus_settings_values SET version=9223372036854775807",
                            )
                            .await?;
                        Ok(())
                    })
                })
                .await
                .unwrap();
            Ok(())
        })
        .await
        .unwrap();
    let large = http(&server, "GET", &path, Value::Null, true, None).await.1;
    assert_eq!(large["status"], "unsupported");
    assert_eq!(large["metadata"]["version"], "9223372036854775807");
    let domain = server.state.domain.clone();
    server
        .state
        .query("failed observation fixture", move |task| async move {
            let mut session = domain.database.session(&task).await.unwrap();
            session
                .transaction::<_, locus_store::api::StoreError, _>(|ctx| {
                    Box::pin(async move {
                        ctx.connection()
                            .batch_execute("DROP TABLE locus_settings_values")
                            .await?;
                        Ok(())
                    })
                })
                .await
                .unwrap();
            Ok(())
        })
        .await
        .unwrap();
    let failed = http(&server, "GET", &path, Value::Null, true, None).await;
    assert_eq!(failed.0, 500);
    assert_eq!(failed.1["diagnostic"]["error"]["code"], "store");
}
#[tokio::test(flavor = "multi_thread")]
async fn settings_lost_handler_is_retained_and_accepted_work_drains() {
    let (_root, server) = app().await;
    let captured = server.state.domain.media_settings.captured.clone();
    let database = server.state.domain.database.clone();
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = tokio::sync::oneshot::channel();
    let holder = server
        .state
        .queue
        .submit("hold DB", move |task| async move {
            let mut session = database.session(&task).await.unwrap();
            session
                .transaction::<_, locus_store::api::StoreError, _>(move |_| {
                    Box::pin(async move {
                        entered_tx.send(()).unwrap();
                        release_rx.await.unwrap();
                        Ok(())
                    })
                })
                .await
                .unwrap();
        })
        .unwrap();
    entered_rx.await.unwrap();
    let request = ChangeSettings {
        request_id: uuid::Uuid::now_v7().to_string(),
        change: SettingsChange::Reset {
            expected_revision: captured.metadata.revision,
        },
    };
    let input = request.clone();
    let state = server.state.clone();
    let handler = tokio::spawn(async move { state.settings_change(MEDIA_TOOL_PATHS, input).await });
    while server.state.lock().active == 0 {
        tokio::task::yield_now().await;
    }
    handler.abort();
    assert_eq!(server.state.close().admission, AdmissionState::Draining);
    release_tx.send(()).unwrap();
    holder.result().await.unwrap();
    server.state.wait_drained().await;
    let Submission::DirectComplete { outcome } =
        server.state.submission(&request.request_id).unwrap()
    else {
        panic!("retained")
    };
    assert!(matches!(outcome, MutationOutcome::SettingsSaved { .. }));
    assert_eq!(
        server
            .state
            .settings_change(MEDIA_TOOL_PATHS, request)
            .await
            .unwrap(),
        outcome
    );
    let fresh = ChangeSettings {
        request_id: uuid::Uuid::now_v7().to_string(),
        change: SettingsChange::Initialize,
    };
    assert!(
        server
            .state
            .settings_change(MEDIA_TOOL_PATHS, fresh)
            .await
            .is_err()
    );
}
#[tokio::test(flavor = "multi_thread")]
async fn invalid_saved_settings_fail_first_load_without_default_repair() {
    let (root, server) = app().await;
    let database = server.state.domain.database.clone();
    server
        .state
        .query("corrupt fixture", move |task| async move {
            let mut session = database.session(&task).await.unwrap();
            session
                .transaction::<_, locus_store::api::StoreError, _>(|ctx| {
                    Box::pin(async move {
                        ctx.connection()
                            .batch_execute("UPDATE locus_settings_values SET payload='{}'")
                            .await?;
                        Ok(())
                    })
                })
                .await
                .unwrap();
            Ok(())
        })
        .await
        .unwrap();
    let config = ServerConfig::new(
        "settings-test-credential-at-least-32-characters".into(),
        root.path().join("library"),
    );
    assert!(Server::bind(config).await.is_err());
    assert!(matches!(
        server.state.settings_read(MEDIA_TOOL_PATHS).await.unwrap(),
        SettingsObservation::Invalid { .. }
    ));
}
