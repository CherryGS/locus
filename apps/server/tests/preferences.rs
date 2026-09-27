#![allow(clippy::expect_used, clippy::unwrap_used)]

use axum::{
    body::Body,
    http::{Request, StatusCode},
    response::Response,
};
use diesel_async::SimpleAsyncConnection;
use http_body_util::BodyExt;
use locus_server::api::{Server, ServerConfig};
use locus_store::api::{Session, StoreError};
use serde_json::{Value, json};
use tower::ServiceExt;

const TOKEN: &str = "preference-http-test-token-at-least-32-characters";
const MISSING: &str = "01992853-c123-7000-8000-ffffffffffff";

async fn app() -> (tempfile::TempDir, Server, String) {
    let root = tempfile::tempdir().unwrap();
    let server = Server::bind(ServerConfig::new(TOKEN.into(), root.path().join("library")))
        .await
        .unwrap();
    let (_, created) = call(
        &server,
        "POST",
        "/api/v1/entities",
        Some(json!({ "request_id": request_id() })),
    )
    .await;
    let entity = created["entity_id"].as_str().unwrap().to_owned();
    (root, server, entity)
}
fn request_id() -> String {
    uuid::Uuid::now_v7().to_string()
}
fn path(entity: &str) -> String {
    format!("/api/v1/entities/{entity}/view-preference")
}
fn request(server: &Server, method: &str, path: &str, body: Option<Value>) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(path)
        .header("authorization", format!("Bearer {TOKEN}"))
        .header("x-locus-run", server.ready().run_id)
        .header("content-type", "application/json")
        .body(body.map_or_else(Body::empty, |value| Body::from(value.to_string())))
        .unwrap()
}
async fn response(response: Response) -> (StatusCode, Value) {
    (
        response.status(),
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap(),
    )
}
async fn call(
    server: &Server,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    response(
        server
            .router()
            .oneshot(request(server, method, path, body))
            .await
            .unwrap(),
    )
    .await
}

#[tokio::test(flavor = "multi_thread")]
async fn reads_are_attributed_and_batch_does_not_inherit_generic_body_quota() {
    let (_root, server, entity) = app().await;
    assert_eq!(
        call(&server, "GET", &path(&entity), None).await.1,
        json!({"status":"unset", "entity_id":entity})
    );
    assert_eq!(
        call(&server, "GET", &path(MISSING), None).await.1,
        json!({"status":"missing", "entity_id":MISSING})
    );
    let values = vec![entity.clone(); 512];
    let body = json!({"entity_ids": values});
    assert!(body.to_string().len() > 16_384);
    let (status, batch) = call(
        &server,
        "POST",
        "/api/v1/entities/view-preferences/batch",
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(batch.as_array().unwrap().len(), 512);
    assert!(
        batch
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item == &json!({"status":"unset", "entity_id":entity}))
    );
    assert_eq!(
        call(
            &server,
            "POST",
            "/api/v1/entities/view-preferences/batch",
            Some(json!({"entity_ids":[]}))
        )
        .await
        .1,
        json!([])
    );
    let (_, saved) = call(&server, "PUT", &path(&entity), Some(json!({"request_id":request_id(), "view_definition_id":"future/vendor-view", "expected_revision":null}))).await;
    assert_eq!(saved["status"], "view_preference_saved");
    let (_, batch) = call(
        &server,
        "POST",
        "/api/v1/entities/view-preferences/batch",
        Some(json!({"entity_ids":[entity,MISSING,entity]})),
    )
    .await;
    assert_eq!(batch[0], batch[2]);
    assert_eq!(batch[0]["view_definition_id"], "future/vendor-view");
    assert_eq!(batch[0]["revision"], "1");
    assert_eq!(batch[1], json!({"status":"missing", "entity_id":MISSING}));
    assert_eq!(
        call(
            &server,
            "PUT",
            &path(MISSING),
            Some(json!({"request_id":request_id(), "view_definition_id":"image"}))
        )
        .await
        .1,
        json!({"status":"view_preference_missing", "entity_id":MISSING})
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn malformed_inputs_and_wrong_run_are_refused_before_request_claim() {
    let (_root, server, entity) = app().await;
    let mut inputs = vec![
        json!({"request_id":"bad", "view_definition_id":"image"}),
        json!({"request_id":request_id(), "view_definition_id":""}),
        json!({"request_id":request_id(), "view_definition_id":" "}),
        json!({"request_id":request_id(), "view_definition_id":"image\n"}),
        json!({"request_id":request_id(), "view_definition_id":"image", "expected_revision":1}),
        json!({"request_id":request_id(), "view_definition_id":"image", "extra":true}),
    ];
    for revision in ["0", "-1", "+1", "01", "1.0", "1e2", "9223372036854775808"] {
        inputs.push(json!({"request_id":request_id(), "view_definition_id":"image", "expected_revision":revision}));
    }
    for input in inputs {
        let (status, value) = call(&server, "PUT", &path(&entity), Some(input.clone())).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{input}");
        assert_eq!(value["code"], "invalid_request");
    }
    for identity in [
        "bad-id",
        "01992853-c123-4000-8000-ffffffffffff",
        "01992853-C123-7000-8000-FFFFFFFFFFFF",
    ] {
        assert_eq!(
            call(&server, "GET", &path(identity), None).await.0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            call(
                &server,
                "POST",
                "/api/v1/entities/view-preferences/batch",
                Some(json!({"entity_ids":[identity]}))
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }
    let id = request_id();
    let input = json!({"request_id":id, "view_definition_id":"image"});
    let mut wrong_run = request(&server, "PUT", &path(&entity), Some(input));
    wrong_run
        .headers_mut()
        .insert("x-locus-run", request_id().parse().unwrap());
    assert_eq!(
        response(server.router().oneshot(wrong_run).await.unwrap())
            .await
            .1["code"],
        "wrong_run"
    );
    assert_eq!(
        call(&server, "GET", &format!("/api/v1/requests/{id}"), None)
            .await
            .1["code"],
        "unknown_request"
    );
    assert_eq!(
        call(&server, "GET", &path(&entity), None).await.1["status"],
        "unset"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn concurrent_same_request_has_one_revision_and_recovery_never_replays_old_value() {
    let (_root, server, entity) = app().await;
    let id = request_id();
    let input = json!({"request_id":id, "view_definition_id":"A"});
    let mut deliveries = Vec::new();
    for _ in 0..8 {
        let router = server.router();
        let request = request(&server, "PUT", &path(&entity), Some(input.clone()));
        deliveries.push(tokio::spawn(async move {
            response(router.oneshot(request).await.unwrap()).await
        }));
    }
    let (_, first) = deliveries.remove(0).await.unwrap();
    assert_eq!(first["preference"]["revision"], "1");
    for delivery in deliveries {
        assert_eq!(delivery.await.unwrap(), (StatusCode::OK, first.clone()));
    }
    for (target, body) in [
        (
            entity.as_str(),
            json!({"request_id":id, "view_definition_id":"B"}),
        ),
        (
            entity.as_str(),
            json!({"request_id":id, "view_definition_id":"A", "expected_revision":"1"}),
        ),
        (MISSING, input.clone()),
    ] {
        assert_eq!(
            call(&server, "PUT", &path(target), Some(body)).await.1["code"],
            "request_conflict"
        );
    }
    let (_, second) = call(
        &server,
        "PUT",
        &path(&entity),
        Some(json!({"request_id":request_id(), "view_definition_id":"B", "expected_revision":"1"})),
    )
    .await;
    assert_eq!(second["preference"]["revision"], "2");
    let (_, conflict) = call(&server, "PUT", &path(&entity), Some(json!({"request_id":request_id(), "view_definition_id":"obsolete", "expected_revision":"1"}))).await;
    assert_eq!(conflict["status"], "view_preference_conflict");
    assert_eq!(conflict["current"]["revision"], "2");
    assert_eq!(conflict["current"]["view_definition_id"], "B");
    // Losing the original response is resolved by its retained outcome, even after
    // another mutation commits. Neither lookup nor re-delivery reapplies A.
    assert_eq!(
        call(&server, "GET", &format!("/api/v1/requests/{id}"), None)
            .await
            .1,
        json!({"status":"direct_complete", "outcome":first})
    );
    assert_eq!(
        call(&server, "PUT", &path(&entity), Some(input.clone()))
            .await
            .1,
        first
    );
    assert_eq!(
        call(&server, "GET", &path(&entity), None).await.1["view_definition_id"],
        "B"
    );
    server.close_admission();
    assert_eq!(
        call(&server, "PUT", &path(&entity), Some(input)).await.1,
        first
    );
}

async fn fixture_sql(root: &tempfile::TempDir, sql: &str) {
    let mut session = Session::open(root.path().join("library/metadata.sqlite"))
        .await
        .unwrap();
    let sql = sql.to_owned();
    session
        .transaction::<_, StoreError, _>(move |context| {
            Box::pin(async move {
                context.connection().batch_execute(&sql).await?;
                Ok(())
            })
        })
        .await
        .unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn real_commit_unknown_is_typed_and_recoverable_with_actual_saved_observation() {
    let (root, server, entity) = app().await;
    call(
        &server,
        "PUT",
        &path(&entity),
        Some(json!({"request_id":request_id(), "view_definition_id":"before"})),
    )
    .await;
    fixture_sql(&root, "CREATE TABLE fixture_parent (id INTEGER PRIMARY KEY);
        CREATE TABLE fixture_child (parent INTEGER REFERENCES fixture_parent(id) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER unknown_preference AFTER UPDATE ON locus_server_comm_entity_view_preference BEGIN INSERT INTO fixture_child VALUES (1); END;").await;
    let id = request_id();
    let input = json!({"request_id":id, "view_definition_id":"uncertain", "expected_revision":"1"});
    let (status, failed) = call(&server, "PUT", &path(&entity), Some(input.clone())).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(failed["status"], "failed");
    assert_eq!(failed["diagnostic"]["owner"], "preferences");
    assert_eq!(failed["diagnostic"]["error"]["code"], "store");
    assert_eq!(
        failed["diagnostic"]["error"]["diagnostic"]["kind"],
        "commit_outcome_unknown"
    );
    assert_eq!(
        call(&server, "GET", &format!("/api/v1/requests/{id}"), None)
            .await
            .1,
        json!({"status":"direct_complete", "outcome":failed})
    );
    assert_eq!(
        call(&server, "PUT", &path(&entity), Some(input)).await.1,
        failed
    );
    assert_eq!(
        call(&server, "GET", &path(&entity), None).await.1,
        json!({"status":"saved", "entity_id":entity, "view_definition_id":"before", "revision":"1"})
    );
    fixture_sql(&root, "DROP TABLE locus_server_comm_entity_view_preference").await;
    let (status, error) = call(
        &server,
        "POST",
        "/api/v1/entities/view-preferences/batch",
        Some(json!({"entity_ids":[MISSING,entity]})),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(error["diagnostic"]["owner"], "preferences");
    assert_eq!(
        error["diagnostic"]["error"]["diagnostic"]["kind"],
        "database"
    );
}
