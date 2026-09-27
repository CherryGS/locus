use super::Shared;
use super::{Server, ServerConfig};
use crate::api::{dto::*, external::dto::*, imports::dto::*, task::dto::AccessContext};
use axum::body::Body;
use std::sync::Arc;
fn id() -> String {
    uuid::Uuid::now_v7().to_string()
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn drained_runtime_refuses_new_duplicate_receiving_but_retains_request_lookup() {
    let root = tempfile::tempdir().unwrap();
    let server = server(root.path()).await;
    let state = &server.state;
    let (token, _) = credential(state).await;
    let request = id();
    let (receipt, _) = upload(state, &token, b"data", request.clone()).await;
    state.close();
    state.wait_drained().await;
    let revision = state.snapshot().revision;
    let error = state
        .receive_upload(
            state.external_authorize(&token).unwrap(),
            UploadMetadata {
                request_id: request.clone(),
                byte_count: "4".into(),
                filename: Some("display.bin".into()),
            },
            Body::from("data"),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, crate::api::ErrorCode::AdmissionClosed);
    assert_eq!(state.snapshot().revision, revision);
    assert_eq!(state.lock().receivers, 0);
    assert_eq!(
        state.external_submission(&request).unwrap(),
        Submission::Accepted { receipt }
    );
    assert!(*state.drained.borrow());
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn exact_declared_length_followed_by_transport_error_is_not_complete_input() {
    let root = tempfile::tempdir().unwrap();
    let server = server(root.path()).await;
    let state = &server.state;
    let (token, _) = credential(state).await;
    let request = id();
    let chunks = vec![
        Ok(axum::body::Bytes::from_static(b"data")),
        Err(std::io::Error::other("incomplete HTTP message after data")),
    ];
    let result = state
        .receive_upload(
            state.external_authorize(&token).unwrap(),
            UploadMetadata {
                request_id: request.clone(),
                byte_count: "4".into(),
                filename: None,
            },
            Body::from_stream(futures_util::stream::iter(chunks)),
        )
        .await;
    assert!(result.is_err());
    assert!(matches!(
        state.external_submission(&request).unwrap(),
        Submission::Rejected { .. }
    ));
    assert!(
        !state
            .snapshot()
            .tasks
            .iter()
            .any(|t| t.request_id == request)
    );
}
async fn external_json(
    state: &Arc<Shared>,
    token: &str,
    path: &str,
    value: serde_json::Value,
) -> axum::response::Response {
    use tower::ServiceExt;
    let address = state
        .access
        .runtime
        .lock()
        .unwrap()
        .active_address
        .clone()
        .unwrap();
    let request = axum::http::Request::builder()
        .method("POST")
        .uri(path)
        .header("Host", address)
        .header("Authorization", format!("Bearer {token}"))
        .header("X-Locus-Run", &state.run_id)
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&value).unwrap()))
        .unwrap();
    crate::api::external::routes::router(state.clone())
        .oneshot(request)
        .await
        .unwrap()
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn external_http_recovery_status_and_structured_error_contracts_match_schema() {
    let root = tempfile::tempdir().unwrap();
    let server = server(root.path()).await;
    let state = &server.state;
    let (token, _) = credential(state).await;
    for (method, path, code) in [
        ("POST", "/external/v1/uploads", "invalid_request"),
        ("POST", "/external/v1/tasks", "method_not_allowed"),
        ("GET", "/external/v1/absent", "not_found"),
    ] {
        let (_, body) = external_http(state, Some(&token), Some(&state.run_id), method, path).await;
        assert_eq!(body["code"], code);
    }
    *state.uploads.registration_fault.lock().unwrap() =
        Some(crate::access::uploads::UploadFault::Rollback);
    let (original, _) = failed_upload(state, &token).await;
    let response = external_json(
        state,
        &token,
        "/external/v1/upload-recoveries",
        serde_json::json!({"request_id":id(),"upload_id":original.request_id,"action":"retry"}),
    )
    .await;
    assert_eq!(response.status(), 202);
    *state.imports.source_fault.lock().unwrap() = Some(crate::imports::BaseFault::Rollback);
    let request = RegisteredImportRequest {
        request_id: id(),
        items: vec![RegisteredImportItem {
            bilibili: None,
            cover_file_id: None,
            file_id: None,
            twitter: Some(crate::api::twitter::dto::TwitterSnapshot {
                post_id: Some("123".into()),
                ..Default::default()
            }),
        }],
    };
    let request_id = request.request_id.clone();
    state
        .registered_import_in(
            AccessContext::External,
            Some(state.external_authorize(&token).unwrap()),
            request,
        )
        .unwrap();
    let receipt = loop {
        match state.external_submission(&request_id).unwrap() {
            Submission::Accepted { receipt } => break receipt,
            Submission::Rejected { error } => panic!("{}", error.message),
            _ => tokio::task::yield_now().await,
        }
    };
    end(state, &receipt).await;
    let batch = state
        .import_snapshot()
        .batches
        .into_iter()
        .find(|b| b.original_request_id == request_id)
        .unwrap();
    let response=external_json(state,&token,"/external/v1/import-recoveries",serde_json::json!({"request_id":id(),"batch_id":batch.batch_id,"item_id":batch.items[0].item_id,"action":"retry"})).await;
    assert_eq!(response.status(), 202);
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn uncertain_partial_evidence_cannot_establish_usable_file_or_authorize_recopy() {
    use crate::access::uploads::UploadFault;
    let root = tempfile::tempdir().unwrap();
    let server = server(root.path()).await;
    let state = &server.state;
    let (token, _) = credential(state).await;
    *state.uploads.registration_fault.lock().unwrap() = Some(UploadFault::Unknown);
    let (original, uncertain) = failed_upload(state, &token).await;
    let candidate = uncertain.candidate_file_id.unwrap();
    sql(
        root.path(),
        format!("DELETE FROM locus_server_rela_access_eligibility WHERE file_id='{candidate}'"),
    )
    .await;
    let receipt = state
        .recover_upload(
            state.external_authorize(&token).unwrap(),
            RecoverUpload {
                request_id: id(),
                upload_id: original.request_id.clone(),
                action: UploadAction::Confirm,
            },
        )
        .unwrap();
    let TaskOutcome::Upload { result } = end(state, &receipt).await else {
        panic!("Expected confirmation evidence")
    };
    assert!(result.uncertain);
    assert!(result.confirmed_file_id.is_none());
    assert_eq!(result.actions, vec![UploadAction::Confirm]);
    assert!(
        state
            .recover_upload(
                state.external_authorize(&token).unwrap(),
                RecoverUpload {
                    request_id: id(),
                    upload_id: original.request_id,
                    action: UploadAction::Recopy
                }
            )
            .is_err()
    );
    let file =
        locus_file::api::FileId::from_bytes(uuid::Uuid::parse_str(&candidate).unwrap().as_bytes())
            .unwrap();
    assert!(state.read(file).await.is_ok());
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn failed_credential_observation_disables_cached_authorization_without_regeneration() {
    let root = tempfile::tempdir().unwrap();
    let server = server(root.path()).await;
    let (token, _) = credential(&server.state).await;
    sql(
        root.path(),
        "UPDATE locus_server_comm_access_credential SET token=X'00' WHERE singleton=1".into(),
    )
    .await;
    assert!(matches!(
        server.state.token_read().await.unwrap(),
        TokenObservation::Unavailable { .. }
    ));
    assert!(server.state.external_authorize(&token).is_err());
    assert!(matches!(
        server.state.token_read().await.unwrap(),
        TokenObservation::Unavailable { .. }
    ));
}
async fn server(root: &std::path::Path) -> Server {
    let mut config = ServerConfig::new("a".repeat(64), root.to_path_buf());
    config.external_address_override = Some("127.0.0.1:0".parse().unwrap());
    Server::bind(config).await.unwrap()
}
async fn credential(state: &Arc<Shared>) -> (String, String) {
    match state.token_read().await.unwrap() {
        TokenObservation::Current {
            token, revision, ..
        } => (token, revision),
        _ => panic!("Expected confirmed test credential"),
    }
}
async fn end(state: &Shared, receipt: &Receipt) -> TaskOutcome {
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            if let OutcomeResponse::Complete { outcome } = state.outcome(&receipt.task_id).unwrap()
            {
                break outcome;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap()
}
async fn upload(
    state: &Arc<Shared>,
    token: &str,
    bytes: &[u8],
    request_id: String,
) -> (Receipt, UploadObservation) {
    let basis = state.external_authorize(token).unwrap();
    let metadata = UploadMetadata {
        request_id: request_id.clone(),
        byte_count: bytes.len().to_string(),
        filename: Some("display.bin".into()),
    };
    let Submission::Accepted { receipt } = state
        .receive_upload(basis, metadata, Body::from(bytes.to_vec()))
        .await
        .unwrap()
    else {
        panic!("Expected upload receipt")
    };
    let TaskOutcome::Upload { result } = end(state, &receipt).await else {
        panic!("Expected upload outcome")
    };
    assert!(result.confirmed_file_id.is_some(), "{:?}", result.problem);
    (receipt, *result)
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn uploaded_file_eligibility_and_token_survive_restart_without_request_replay() {
    let temp = tempfile::tempdir().unwrap();
    let first = server(temp.path()).await;
    let state = first.state.clone();
    let (token, revision) = credential(&state).await;
    let request = id();
    let (receipt, result) = upload(&state, &token, b"normal bytes", request.clone()).await;
    let file = result.confirmed_file_id.unwrap();
    let new_revision = match state
        .token_reset(ResetToken {
            request_id: id(),
            expected_revision: revision,
        })
        .await
        .unwrap()
    {
        MutationOutcome::TokenReset { revision } => revision,
        _ => panic!("Reset failed"),
    };
    let (current, current_revision) = credential(&state).await;
    assert!(current_revision == new_revision);
    assert!(current != token);
    assert!(state.external_authorize(&token).is_err());
    assert!(matches!(
        state.external_submission(&request).unwrap(),
        Submission::Accepted { .. }
    ));
    drop(state);
    drop(first);
    let second = server(temp.path()).await;
    let (reopened, revision) = credential(&second.state).await;
    assert!(reopened == current);
    assert!(revision == new_revision);
    assert!(second.state.external_submission(&request).is_err());
    assert!(second.state.task(&receipt.task_id).is_err());
    assert!(second.state.import_snapshot().batches.is_empty());
    let basis = second.state.external_authorize(&reopened).unwrap();
    let request_id = id();
    second
        .state
        .registered_import_in(
            AccessContext::External,
            Some(basis),
            RegisteredImportRequest {
                request_id: request_id.clone(),
                items: vec![RegisteredImportItem {
                    bilibili: None,
                    cover_file_id: None,
                    file_id: Some(file),
                    twitter: None,
                }],
            },
        )
        .unwrap();
    let receipt = loop {
        match second.state.external_submission(&request_id).unwrap() {
            Submission::Accepted { receipt } => break receipt,
            Submission::Rejected { error } => panic!("{}", error.message),
            _ => tokio::task::yield_now().await,
        }
    };
    assert!(matches!(
        end(&second.state, &receipt).await,
        TaskOutcome::ImportBatch { .. }
    ));
    assert!(
        second.state.import_snapshot().batches[0].items[0]
            .current
            .confirmed_entity_id
            .is_some()
    );
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn zero_chunked_mismatch_and_effective_duplicate_bytes() {
    let temp = tempfile::tempdir().unwrap();
    let server = server(temp.path()).await;
    let state = &server.state;
    let (token, _) = credential(state).await;
    upload(state, &token, b"", id()).await;
    let metadata = UploadMetadata {
        request_id: id(),
        byte_count: "6".into(),
        filename: None,
    };
    let body = Body::from_stream(futures_util::stream::iter([
        Ok::<_, std::io::Error>("ab"),
        Ok("cd"),
        Ok("ef"),
    ]));
    let original = state
        .receive_upload(
            state.external_authorize(&token).unwrap(),
            metadata.clone(),
            body,
        )
        .await
        .unwrap();
    let replay = state
        .receive_upload(
            state.external_authorize(&token).unwrap(),
            metadata.clone(),
            Body::from("abcdef"),
        )
        .await
        .unwrap();
    assert_eq!(original, replay);
    let changed = state
        .receive_upload(
            state.external_authorize(&token).unwrap(),
            metadata.clone(),
            Body::from("abcdeg"),
        )
        .await
        .unwrap_err();
    assert_eq!(changed.code, crate::api::ErrorCode::RequestConflict);
    let mut changed_name = metadata.clone();
    changed_name.filename = Some("changed".into());
    assert!(
        state
            .receive_upload(
                state.external_authorize(&token).unwrap(),
                changed_name,
                Body::from("abcdef")
            )
            .await
            .is_err()
    );
    let mut incomplete = metadata;
    incomplete.request_id = id();
    let request = incomplete.request_id.clone();
    assert!(
        state
            .receive_upload(
                state.external_authorize(&token).unwrap(),
                incomplete,
                Body::from("abc")
            )
            .await
            .is_err()
    );
    assert!(matches!(
        state.external_submission(&request).unwrap(),
        Submission::Rejected { .. }
    ));
    assert!(
        !state
            .snapshot()
            .tasks
            .iter()
            .any(|t| t.request_id == request)
    );
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn reset_stops_idle_receiving_and_new_token_observes_accepted_work() {
    let temp = tempfile::tempdir().unwrap();
    let server = server(temp.path()).await;
    let state = server.state.clone();
    let (token, revision) = credential(&state).await;
    let request = id();
    let metadata = UploadMetadata {
        request_id: request.clone(),
        byte_count: "5".into(),
        filename: None,
    };
    let worker = state.clone();
    let basis = state.external_authorize(&token).unwrap();
    let receiving = tokio::spawn(async move {
        worker
            .receive_upload(
                basis,
                metadata,
                Body::from_stream(futures_util::stream::pending::<
                    Result<axum::body::Bytes, std::io::Error>,
                >()),
            )
            .await
    });
    while state.lock().receivers == 0 {
        tokio::task::yield_now().await;
    }
    let reset_id = id();
    let reset = ResetToken {
        request_id: reset_id.clone(),
        expected_revision: revision,
    };
    let outcome = state.token_reset(reset.clone()).await.unwrap();
    assert_eq!(outcome, state.token_reset(reset).await.unwrap());
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(2), receiving)
            .await
            .unwrap()
            .unwrap()
            .is_err()
    );
    assert_eq!(state.lock().receivers, 0);
    assert!(matches!(
        state.external_submission(&request).unwrap(),
        Submission::Rejected { .. }
    ));
    let (current, _) = credential(&state).await;
    let (receipt, _) = upload(&state, &current, b"after reset", id()).await;
    assert_eq!(
        state.task(&receipt.task_id).unwrap().access_context,
        AccessContext::External
    );
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn close_stops_unaccepted_idle_network_input_without_calling_it_accepted_work() {
    let temp = tempfile::tempdir().unwrap();
    let server = server(temp.path()).await;
    let state = server.state.clone();
    let (token, _) = credential(&state).await;
    let worker = state.clone();
    let basis = state.external_authorize(&token).unwrap();
    let receiving = tokio::spawn(async move {
        worker
            .receive_upload(
                basis,
                UploadMetadata {
                    request_id: id(),
                    byte_count: "9".into(),
                    filename: None,
                },
                Body::from_stream(futures_util::stream::pending::<
                    Result<axum::body::Bytes, std::io::Error>,
                >()),
            )
            .await
    });
    while state.lock().receivers == 0 {
        tokio::task::yield_now().await;
    }
    assert_eq!(state.status().active_operations, "0");
    state.close();
    tokio::time::timeout(std::time::Duration::from_secs(2), state.wait_drained())
        .await
        .unwrap();
    assert!(receiving.await.unwrap().is_err());
}

async fn failed_upload(state: &Arc<Shared>, token: &str) -> (Receipt, UploadObservation) {
    let request = id();
    let metadata = UploadMetadata {
        request_id: request,
        byte_count: "4".into(),
        filename: None,
    };
    let Submission::Accepted { receipt } = state
        .receive_upload(
            state.external_authorize(token).unwrap(),
            metadata,
            Body::from("data"),
        )
        .await
        .unwrap()
    else {
        panic!("Expected accepted upload")
    };
    let outcome = end(state, &receipt).await;
    let result = match outcome {
        TaskOutcome::Upload { result } => result,
        _ => Box::new(state.upload_observation(&receipt.request_id).unwrap()),
    };
    (receipt, *result)
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn registration_rollback_reuses_preparation_and_unknown_commit_requires_coherent_confirmation()
 {
    use crate::access::uploads::UploadFault;
    let root = tempfile::tempdir().unwrap();
    let server = server(root.path()).await;
    let s = &server.state;
    let (token, _) = credential(s).await;
    *s.uploads.registration_fault.lock().unwrap() = Some(UploadFault::Rollback);
    let (original, failed) = failed_upload(s, &token).await;
    assert!(failed.confirmed_file_id.is_none());
    assert_eq!(failed.actions, vec![UploadAction::Retry]);
    let candidate = failed.candidate_file_id.clone();
    let request = RecoverUpload {
        request_id: id(),
        upload_id: original.request_id.clone(),
        action: UploadAction::Retry,
    };
    let barrier = Arc::new(tokio::sync::Barrier::new(2));
    let deliveries = (0..2)
        .map(|_| {
            let state = s.clone();
            let request = request.clone();
            let basis = s.external_authorize(&token).unwrap();
            let barrier = barrier.clone();
            tokio::spawn(async move {
                barrier.wait().await;
                state.recover_upload(basis, request).unwrap()
            })
        })
        .collect::<Vec<_>>();
    let mut receipts = Vec::new();
    for delivery in deliveries {
        receipts.push(delivery.await.unwrap());
    }
    let a = receipts.remove(0);
    let b = receipts.remove(0);
    assert_eq!(a, b);
    let TaskOutcome::Upload { result } = end(s, &a).await else {
        panic!("Expected recovered File")
    };
    assert_eq!(result.confirmed_file_id, candidate);
    let TaskOutcome::Upload { result: retained } = end(s, &original).await else {
        panic!("Expected immutable original")
    };
    assert_eq!(*retained, failed);
    *s.uploads.registration_fault.lock().unwrap() = Some(UploadFault::Unknown);
    let (original, uncertain) = failed_upload(s, &token).await;
    assert!(uncertain.uncertain);
    assert_eq!(uncertain.actions, vec![UploadAction::Confirm]);
    assert!(
        s.recover_upload(
            s.external_authorize(&token).unwrap(),
            RecoverUpload {
                request_id: id(),
                upload_id: original.request_id.clone(),
                action: UploadAction::Retry
            }
        )
        .is_err()
    );
    let confirmation = s
        .recover_upload(
            s.external_authorize(&token).unwrap(),
            RecoverUpload {
                request_id: id(),
                upload_id: original.request_id,
                action: UploadAction::Confirm,
            },
        )
        .unwrap();
    let TaskOutcome::Upload { result } = end(s, &confirmation).await else {
        panic!("Expected confirmation")
    };
    assert_eq!(result.confirmed_file_id, uncertain.candidate_file_id);
    assert!(!result.uncertain);
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn unusable_preparation_requires_explicit_copy_and_executor_end_does_not_leave_active_upload()
{
    use crate::access::uploads::UploadFault;
    let root = tempfile::tempdir().unwrap();
    let server = server(root.path()).await;
    let s = &server.state;
    let (token, _) = credential(s).await;
    *s.uploads.preparation_failure.lock().unwrap() = true;
    let (_, preparation) = failed_upload(s, &token).await;
    assert!(preparation.candidate_file_id.is_some());
    assert!(!preparation.copy_complete);
    assert_eq!(preparation.actions, vec![UploadAction::Recopy]);
    *s.uploads.registration_fault.lock().unwrap() = Some(UploadFault::Rollback);
    let (receipt, failed) = failed_upload(s, &token).await;
    // Simulate external corruption of the File-owned preparation without deleting
    // it. Recovery must never hide that unusable copy or overwrite its object.
    let candidate = uuid::Uuid::parse_str(failed.candidate_file_id.as_ref().unwrap())
        .unwrap()
        .simple()
        .to_string();
    let object = root
        .path()
        .join("object")
        .join(&candidate[28..])
        .join(&candidate);
    std::fs::write(&object, b"changed length").unwrap();
    let retry = s
        .recover_upload(
            s.external_authorize(&token).unwrap(),
            RecoverUpload {
                request_id: id(),
                upload_id: receipt.request_id.clone(),
                action: UploadAction::Retry,
            },
        )
        .unwrap();
    let TaskOutcome::Upload { result } = end(s, &retry).await else {
        panic!("Expected attributable failed retry")
    };
    assert_eq!(result.actions, vec![UploadAction::Recopy]);
    let copy = s
        .recover_upload(
            s.external_authorize(&token).unwrap(),
            RecoverUpload {
                request_id: id(),
                upload_id: receipt.request_id,
                action: UploadAction::Recopy,
            },
        )
        .unwrap();
    let TaskOutcome::Upload { result } = end(s, &copy).await else {
        panic!("Expected explicit new copy")
    };
    assert!(result.confirmed_file_id.is_some());
    assert_ne!(result.confirmed_file_id, failed.candidate_file_id);
    assert_eq!(std::fs::read(object).unwrap(), b"changed length");
    *s.uploads.registration_fault.lock().unwrap() = Some(UploadFault::Panic);
    let (_, failed) = failed_upload(s, &token).await;
    assert!(failed.active_request_id.is_none());
    assert!(failed.uncertain);
    assert_eq!(failed.actions, vec![UploadAction::Confirm]);
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn reset_before_acceptance_rejects_but_reset_after_acceptance_preserves_worker_and_writer_drain()
 {
    let root = tempfile::tempdir().unwrap();
    let server = server(root.path()).await;
    let s = server.state.clone();
    let (token, revision) = credential(&s).await;
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    *s.uploads.pause_acceptance.lock().unwrap() = Some((entered.clone(), release.clone()));
    let worker = s.clone();
    let basis = s.external_authorize(&token).unwrap();
    let request = id();
    let original = request.clone();
    let receiving = tokio::spawn(async move {
        worker
            .receive_upload(
                basis,
                UploadMetadata {
                    request_id: request,
                    byte_count: "4".into(),
                    filename: None,
                },
                Body::from("data"),
            )
            .await
    });
    entered.notified().await;
    s.token_reset(ResetToken {
        request_id: id(),
        expected_revision: revision,
    })
    .await
    .unwrap();
    release.notify_one();
    assert!(receiving.await.unwrap().is_err());
    assert!(!s.snapshot().tasks.iter().any(|t| t.request_id == original));
    let (token, revision) = credential(&s).await;
    *s.uploads.pause_admission.lock().unwrap() = Some((entered.clone(), release.clone()));
    let Submission::Accepted { receipt } = s
        .receive_upload(
            s.external_authorize(&token).unwrap(),
            UploadMetadata {
                request_id: id(),
                byte_count: "4".into(),
                filename: None,
            },
            Body::from("data"),
        )
        .await
        .unwrap()
    else {
        panic!("Expected accepted work")
    };
    entered.notified().await;
    s.token_reset(ResetToken {
        request_id: id(),
        expected_revision: revision,
    })
    .await
    .unwrap();
    release.notify_one();
    let TaskOutcome::Upload { result } = end(&s, &receipt).await else {
        panic!("Expected completed accepted File")
    };
    assert!(result.confirmed_file_id.is_some());
    let (token, _) = credential(&s).await;
    let (unblock, wait) = std::sync::mpsc::channel();
    *s.uploads.pause_writer.lock().unwrap() = Some((entered.clone(), wait));
    let worker = s.clone();
    let basis = s.external_authorize(&token).unwrap();
    let receiving = tokio::spawn(async move {
        worker
            .receive_upload(
                basis,
                UploadMetadata {
                    request_id: id(),
                    byte_count: "4".into(),
                    filename: None,
                },
                Body::from("data"),
            )
            .await
    });
    entered.notified().await;
    s.close();
    assert!(!*s.drained.borrow());
    assert_eq!(s.status().admission, AdmissionState::Draining);
    assert_eq!(s.lock().receivers, 1);
    assert!(!receiving.is_finished());
    unblock.send(()).unwrap();
    assert!(receiving.await.unwrap().is_err());
    s.wait_drained().await;
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn reset_unknown_or_executor_loss_disables_cached_credential_and_reread_establishes_current()
{
    use crate::access::state::ResetFault;
    let root = tempfile::tempdir().unwrap();
    let server = server(root.path()).await;
    let s = &server.state;
    for fault in [
        ResetFault::Rollback,
        ResetFault::Unknown,
        ResetFault::PanicAfterCommit,
    ] {
        let (token, revision) = credential(s).await;
        *s.access.reset_fault.lock().unwrap() = Some(fault);
        let request = ResetToken {
            request_id: id(),
            expected_revision: revision,
        };
        let result = s.token_reset(request.clone()).await.unwrap();
        assert_eq!(result, s.token_reset(request).await.unwrap());
        if matches!(fault, ResetFault::Rollback) {
            assert!(s.external_authorize(&token).is_ok());
        } else {
            assert!(s.external_authorize(&token).is_err());
        }
        let (current, _) = credential(s).await;
        assert!(s.external_authorize(&current).is_ok());
        assert_eq!(current == token, matches!(fault, ResetFault::Rollback));
    }
}
async fn sql(root: &std::path::Path, statement: String) {
    use diesel_async::SimpleAsyncConnection;
    let mut session = locus_store::api::Session::open(root.join("metadata.sqlite"))
        .await
        .unwrap();
    session
        .transaction::<_, anyhow::Error, _>(move |c| {
            Box::pin(async move {
                c.connection().batch_execute(&statement).await?;
                Ok(())
            })
        })
        .await
        .unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_first_provision_and_future_revision_reset_preserve_opaque_library_identity() {
    let root = tempfile::tempdir().unwrap();
    let config = || {
        let mut value = ServerConfig::new("a".repeat(64), root.path().to_path_buf());
        value.external_address_override = Some("127.0.0.1:0".parse().unwrap());
        value
    };
    let (a, b) = tokio::join!(Server::bind(config()), Server::bind(config()));
    let (a, error) = match (a, b) {
        (Ok(a), Err(error)) | (Err(error), Ok(a)) => (a, error),
        _ => panic!("Exactly one runtime may acquire the library"),
    };
    assert!(super::StartupFailure::from_error(&error).is_some());
    let (one, _) = credential(&a.state).await;
    assert!(Server::bind(config()).await.is_err());
    let (two, _) = credential(&a.state).await;
    assert!(one == two);
    drop(a);
    sql(root.path(),"UPDATE locus_server_comm_access_credential SET revision='ffffffff-ffff-7fff-8fff-ffffffffffff' WHERE singleton=1".into()).await;
    let a = server(root.path()).await;
    let (old, revision) = credential(&a.state).await;
    assert!(
        a.state
            .token_reset(ResetToken {
                request_id: id(),
                expected_revision: revision
            })
            .await
            .is_ok()
    );
    let (new, _) = credential(&a.state).await;
    assert!(old != new);
    assert!(a.state.external_authorize(&old).is_err());
    assert!(a.state.external_authorize(&new).is_ok());
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn corrupt_existing_credential_and_restricted_first_start_never_silently_provision() {
    use diesel_async::RunQueryDsl;
    #[derive(diesel::QueryableByName)]
    struct Count {
        #[diesel(sql_type=diesel::sql_types::BigInt)]
        count: i64,
    }
    let root = tempfile::tempdir().unwrap();
    let a = server(root.path()).await;
    drop(a);
    sql(
        root.path(),
        "UPDATE locus_server_comm_access_credential SET token='corrupt' WHERE singleton=1".into(),
    )
    .await;
    let a = server(root.path()).await;
    assert!(matches!(
        a.state.token_read().await.unwrap(),
        TokenObservation::Unavailable { .. }
    ));
    let mut session = locus_store::api::Session::open(root.path().join("metadata.sqlite"))
        .await
        .unwrap();
    let count = session
        .transaction::<_, anyhow::Error, _>(|c| {
            Box::pin(async move {
                Ok(diesel::sql_query(
                    "SELECT count(*) AS count FROM locus_server_comm_access_credential WHERE token != 'corrupt'",
                )
                .get_result::<Count>(c.connection())
                .await?
                .count)
            })
        })
        .await
        .unwrap();
    assert_eq!(count, 0);
    let other = tempfile::tempdir().unwrap();
    let queue = locus_task::api::TaskQueue::new();
    let library = super::composition::Library::open(&queue, other.path(), None)
        .await
        .unwrap();
    queue
        .submit("Initialize fixture configuration", move |task| async move {
            let mut session = library.database.session(&task).await.unwrap();
            library
                .settings
                .initialize(&mut session, locus_media::api::MEDIA_TOOL_PATHS)
                .await
                .unwrap();
        })
        .unwrap()
        .result()
        .await
        .unwrap();
    sql(other.path(),"UPDATE locus_settings_comm_group_value SET payload='{}' WHERE group_id='25c3fd2a-4148-4cb3-aca4-47c3ce3402e5'".into()).await;
    let repair = server(other.path()).await;
    assert!(matches!(
        repair.state.availability,
        Availability::Restricted { .. }
    ));
    assert!(
        repair
            .state
            .token_reset(ResetToken {
                request_id: id(),
                expected_revision: id()
            })
            .await
            .is_err()
    );
    let mut session = locus_store::api::Session::open(other.path().join("metadata.sqlite"))
        .await
        .unwrap();
    let count = session
        .transaction::<_, anyhow::Error, _>(|c| {
            Box::pin(async move {
                Ok(diesel::sql_query(
                    "SELECT count(*) AS count FROM locus_server_comm_access_credential",
                )
                .get_result::<Count>(c.connection())
                .await?
                .count)
            })
        })
        .await
        .unwrap();
    assert_eq!(count, 0);
}
async fn external_http(
    s: &Arc<Shared>,
    token: Option<&str>,
    run: Option<&str>,
    method: &str,
    path: &str,
) -> (axum::http::StatusCode, serde_json::Value) {
    use http_body_util::BodyExt;
    use tower::ServiceExt;
    let address = s
        .access
        .runtime
        .lock()
        .unwrap()
        .active_address
        .clone()
        .unwrap();
    let mut request = axum::http::Request::builder()
        .method(method)
        .uri(path)
        .header("Host", address);
    if let Some(token) = token {
        request = request.header("Authorization", format!("Bearer {token}"));
    }
    if let Some(run) = run {
        request = request.header("X-Locus-Run", run);
    }
    let response = crate::api::external::routes::router(s.clone())
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    assert_eq!(response.headers()["access-control-allow-origin"], "*");
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn limited_router_and_cross_namespace_collisions_do_not_disclose_or_overwrite_desktop_work() {
    let root = tempfile::tempdir().unwrap();
    let a = server(root.path()).await;
    let s = &a.state;
    let (token, _) = credential(s).await;
    let (status, bootstrap) = external_http(s, None, None, "GET", "/external/v1/bootstrap").await;
    assert_eq!(status, 200);
    assert_eq!(bootstrap.as_object().unwrap().len(), 1);
    assert!(bootstrap.get("run_id").is_some());
    assert_eq!(
        external_http(s, None, None, "OPTIONS", "/external/v1/uploads")
            .await
            .0,
        204
    );
    assert_eq!(
        external_http(s, None, Some(&s.run_id), "GET", "/external/v1/tasks")
            .await
            .0,
        401
    );
    assert_eq!(
        external_http(
            s,
            Some(&token),
            Some("old-run"),
            "GET",
            "/external/v1/tasks"
        )
        .await
        .0,
        409
    );
    assert_eq!(
        external_http(s, Some(&token), Some(&s.run_id), "GET", "/api/v1/entities")
            .await
            .0,
        404
    );
    let same = id();
    let (external, _) = upload(s, &token, b"external", same.clone()).await;
    let source = root.path().join("local");
    std::fs::write(&source, b"local").unwrap();
    let local = s
        .import(crate::api::file::dto::ImportRequest {
            request_id: same.clone(),
            source_path: source.to_string_lossy().into(),
        })
        .unwrap();
    assert_ne!(external.task_id, local.task_id);
    let result = end(s, &local).await;
    let TaskOutcome::Imported { file } = result else {
        panic!("Expected local File")
    };
    assert_eq!(
        external_http(
            s,
            Some(&token),
            Some(&s.run_id),
            "GET",
            &format!("/external/v1/tasks/{}/outcome", local.task_id)
        )
        .await
        .0,
        404
    );
    let request = RegisteredImportRequest {
        request_id: id(),
        items: vec![RegisteredImportItem {
            bilibili: None,
            cover_file_id: None,
            file_id: Some(file.file_id),
            twitter: None,
        }],
    };
    let request_id = request.request_id.clone();
    s.registered_import_in(
        AccessContext::External,
        Some(s.external_authorize(&token).unwrap()),
        request,
    )
    .unwrap();
    loop {
        match s.external_submission(&request_id).unwrap() {
            Submission::Rejected { .. } => break,
            Submission::Accepted { .. } => panic!("Desktop File must not become eligible"),
            _ => tokio::task::yield_now().await,
        }
    }
    let request = RegisteredImportRequest {
        request_id: id(),
        items: vec![RegisteredImportItem {
            bilibili: None,
            cover_file_id: None,
            file_id: None,
            twitter: Some(crate::api::twitter::dto::TwitterSnapshot {
                post_id: Some("123".into()),
                ..Default::default()
            }),
        }],
    };
    let external_id = request.request_id.clone();
    s.registered_import_in(
        AccessContext::External,
        Some(s.external_authorize(&token).unwrap()),
        request,
    )
    .unwrap();
    let receipt = loop {
        match s.external_submission(&external_id).unwrap() {
            Submission::Accepted { receipt } => break receipt,
            Submission::Rejected { error } => panic!("{}", error.message),
            _ => tokio::task::yield_now().await,
        }
    };
    end(s, &receipt).await;
    let external_batch = s
        .import_snapshot()
        .batches
        .into_iter()
        .find(|b| b.original_request_id == external_id)
        .unwrap();
    let desktop = RegisteredImportRequest {
        request_id: external_batch.batch_id.clone(),
        items: vec![RegisteredImportItem {
            bilibili: None,
            cover_file_id: None,
            file_id: None,
            twitter: Some(crate::api::twitter::dto::TwitterSnapshot {
                post_id: Some("456".into()),
                ..Default::default()
            }),
        }],
    };
    s.registered_import(desktop.clone()).unwrap();
    let receipt = loop {
        match s.submission(&desktop.request_id).unwrap() {
            Submission::Accepted { receipt } => break receipt,
            Submission::Rejected { error } => panic!("{}", error.message),
            _ => tokio::task::yield_now().await,
        }
    };
    end(s, &receipt).await;
    let snapshot = s.import_snapshot();
    assert_eq!(snapshot.batches.len(), 2);
    assert!(
        snapshot
            .batches
            .iter()
            .any(|b| b.batch_id == external_batch.batch_id
                && b.access_context == AccessContext::External)
    );
    assert!(
        snapshot
            .batches
            .iter()
            .any(|b| b.original_request_id == external_batch.batch_id
                && b.batch_id != external_batch.batch_id)
    );
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn reset_between_observer_authorization_and_frame_production_prevents_new_snapshot_delivery()
{
    use http_body_util::BodyExt;
    use tower::ServiceExt;
    let root = tempfile::tempdir().unwrap();
    let a = server(root.path()).await;
    let s = &a.state;
    let (token, revision) = credential(s).await;
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    *s.access.pause_event.lock().unwrap() = Some((entered.clone(), release.clone()));
    let address = s
        .access
        .runtime
        .lock()
        .unwrap()
        .active_address
        .clone()
        .unwrap();
    let request = axum::http::Request::builder()
        .uri("/external/v1/task-events")
        .header("Host", address)
        .header("Authorization", format!("Bearer {token}"))
        .header("X-Locus-Run", &s.run_id)
        .body(Body::empty())
        .unwrap();
    let response = crate::api::external::routes::router(s.clone())
        .oneshot(request)
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let reading = tokio::spawn(async move { response.into_body().frame().await });
    entered.notified().await;
    s.token_reset(ResetToken {
        request_id: id(),
        expected_revision: revision,
    })
    .await
    .unwrap();
    let (current, _) = credential(s).await;
    upload(s, &current, b"post-reset result", id()).await;
    release.notify_one();
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(2), reading)
            .await
            .unwrap()
            .unwrap()
            .is_none()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bilibili_external_upload_cover_eligibility_and_original_recovery() {
    let root = tempfile::tempdir().unwrap();
    let server = server(root.path()).await;
    let s = &server.state;
    let (token, _) = credential(s).await;
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
        8,
        8,
        image::Rgb([80, 100, 120]),
    ))
    .write_to(&mut png, image::ImageFormat::Png)
    .unwrap();
    let (_, main) = upload(s, &token, png.get_ref(), id()).await;
    let (_, cover) = upload(s, &token, png.get_ref(), id()).await;
    let main = main.confirmed_file_id.unwrap();
    let cover = cover.confirmed_file_id.unwrap();
    let request = RegisteredImportRequest {
        request_id: id(),
        items: vec![RegisteredImportItem {
            file_id: Some(main.clone()),
            cover_file_id: Some(cover.clone()),
            twitter: None,
            bilibili: Some(crate::api::bilibili::dto::BilibiliSnapshot {
                aid: Some("123".into()),
                ..Default::default()
            }),
        }],
    };
    *s.imports.bilibili_cover_fault.lock().unwrap() = Some(crate::imports::BaseFault::Rollback);
    let request_id = request.request_id.clone();
    let response = external_json(
        s,
        &token,
        "/external/v1/import-batches",
        serde_json::to_value(&request).unwrap(),
    )
    .await;
    assert_eq!(response.status(), 202);
    let receipt = loop {
        match s.external_submission(&request_id).unwrap() {
            Submission::Accepted { receipt } => break receipt,
            Submission::Rejected { error } => panic!("{}", error.message),
            _ => tokio::task::yield_now().await,
        }
    };
    end(s, &receipt).await;
    let initial = s
        .import_snapshot()
        .batches
        .into_iter()
        .find(|b| b.original_request_id == request_id)
        .unwrap();
    assert!(!initial.items[0].current.complete);
    assert!(initial.items[0].current.confirmed_entity_id.is_some());
    let retry = ImportRecoveryRequest {
        request_id: id(),
        batch_id: initial.batch_id.clone(),
        item_id: initial.items[0].item_id.clone(),
        action: ImportAction::Retry,
    };
    assert!(
        s.recover_import(retry.clone()).is_err(),
        "Desktop must not take over external recovery"
    );
    let response = external_json(
        s,
        &token,
        "/external/v1/import-recoveries",
        serde_json::to_value(&retry).unwrap(),
    )
    .await;
    assert_eq!(response.status(), 202);
    let Submission::Accepted { receipt } = s.external_submission(&retry.request_id).unwrap() else {
        panic!("expected recovery")
    };
    end(s, &receipt).await;
    let done = s
        .import_snapshot()
        .batches
        .into_iter()
        .find(|b| b.batch_id == initial.batch_id)
        .unwrap();
    assert!(done.items[0].current.complete, "{:#?}", done.items[0]);
    assert_eq!(
        done.items[0].current.entity_id,
        initial.items[0].current.entity_id
    );
    assert_eq!(done.items[0].attempts.len(), 2);
    assert_eq!(done.original_overall, Some(ImportOverall::Failure));
    // Independently revoke each newly uploaded input's grant before new admission.
    for bad_cover in [false, true] {
        let (_, main) = upload(s, &token, png.get_ref(), id()).await;
        let (_, cover) = upload(s, &token, png.get_ref(), id()).await;
        let main = main.confirmed_file_id.unwrap();
        let cover = cover.confirmed_file_id.unwrap();
        sql(
            root.path(),
            format!(
                "DELETE FROM locus_server_rela_access_eligibility WHERE file_id='{}'",
                if bad_cover { &cover } else { &main }
            ),
        )
        .await;
        let mut r = request.clone();
        r.request_id = id();
        r.items[0].file_id = Some(main);
        r.items[0].cover_file_id = Some(cover);
        s.registered_import_in(
            AccessContext::External,
            Some(s.external_authorize(&token).unwrap()),
            r.clone(),
        )
        .unwrap();
        loop {
            match s.external_submission(&r.request_id).unwrap() {
                Submission::Rejected { error } => {
                    assert!(error.message.contains("not eligible"));
                    break;
                }
                Submission::AdmissionPending => tokio::task::yield_now().await,
                other => panic!("Unexpected {other:?}"),
            }
        }
        assert!(
            !s.import_snapshot()
                .batches
                .iter()
                .any(|b| b.original_request_id == r.request_id)
        );
    }
}
