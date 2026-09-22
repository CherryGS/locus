use super::{registry::ServerConfig, server::Server};
use crate::{
    api::{
        dto::{AdmissionState, MutationOutcome, Submission},
        error::ErrorCode,
    },
    preferences::identity::{SavedRevision, ViewDefinitionId},
};
use locus_core::api::EntityId;
use tokio::sync::oneshot;

async fn app() -> (tempfile::TempDir, Server, EntityId) {
    let root = tempfile::tempdir().unwrap();
    let server = Server::bind(ServerConfig::new(
        "preference-test-credential-at-least-32-characters".into(),
        root.path().join("library"),
    ))
    .await
    .unwrap();
    let MutationOutcome::EntityCreated { entity_id } = server
        .state
        .create_entity(uuid::Uuid::now_v7().to_string())
        .await
        .unwrap()
    else {
        panic!("entity")
    };
    let entity =
        EntityId::from_bytes(uuid::Uuid::parse_str(&entity_id).unwrap().as_bytes()).unwrap();
    (root, server, entity)
}

fn view() -> ViewDefinitionId {
    ViewDefinitionId::new("future/view".into()).unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn preference_launch_rejection_is_retained_and_changed_arguments_conflict() {
    let (_root, server, entity) = app().await;
    server.state.lock().reject_next_launch = true;
    let id = uuid::Uuid::now_v7().to_string();
    let error = server
        .state
        .update_view_preference(id.clone(), entity, view(), None)
        .await
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::LaunchRejected);
    server.state.close();
    assert_eq!(
        server
            .state
            .update_view_preference(id.clone(), entity, view(), None)
            .await
            .unwrap_err(),
        error
    );
    assert_eq!(
        server.state.submission(&id).unwrap(),
        Submission::Rejected { error }
    );
    assert_eq!(
        server
            .state
            .update_view_preference(id, entity, view(), Some(SavedRevision::new(1).unwrap()))
            .await
            .unwrap_err()
            .code,
        ErrorCode::RequestConflict
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn accepted_preference_survives_lost_handler_and_drains_with_original_recovery() {
    let (_root, server, entity) = app().await;
    let database = server.state.library.database.clone();
    let (locked_tx, locked_rx) = oneshot::channel();
    let (release_tx, release_rx) = oneshot::channel();
    let holder = server
        .state
        .queue
        .submit("hold DB", move |task| async move {
            let mut session = database.session(&task).await.unwrap();
            session
                .transaction::<_, locus_store::api::StoreError, _>(move |_| {
                    Box::pin(async move {
                        locked_tx.send(()).unwrap();
                        release_rx.await.unwrap();
                        Ok(())
                    })
                })
                .await
                .unwrap();
        })
        .unwrap();
    locked_rx.await.unwrap();
    let id = uuid::Uuid::now_v7().to_string();
    let state = server.state.clone();
    let request_id = id.clone();
    let handler = tokio::spawn(async move {
        state
            .update_view_preference(request_id, entity, view(), None)
            .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        while !matches!(server.state.submission(&id), Ok(Submission::DirectPending)) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    handler.abort();
    assert!(handler.await.unwrap_err().is_cancelled());
    assert_eq!(server.state.close().admission, AdmissionState::Draining);
    assert!(!*server.state.drained.borrow());
    assert_eq!(
        server
            .state
            .update_view_preference(uuid::Uuid::now_v7().to_string(), entity, view(), None)
            .await
            .unwrap_err()
            .code,
        ErrorCode::AdmissionClosed
    );
    release_tx.send(()).unwrap();
    holder.result().await.unwrap();
    server.state.wait_drained().await;
    let outcome = server
        .state
        .update_view_preference(id.clone(), entity, view(), None)
        .await
        .unwrap();
    let MutationOutcome::ViewPreferenceSaved { preference } = &outcome else {
        panic!("save")
    };
    assert_eq!(preference.revision, "1");
    assert_eq!(
        server.state.submission(&id).unwrap(),
        Submission::DirectComplete { outcome }
    );
    assert!(server.state.snapshot().tasks.is_empty());
}
