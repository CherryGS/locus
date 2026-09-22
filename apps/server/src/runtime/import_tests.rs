use super::{Server, ServerConfig};
use crate::{
    api::{
        dto::{OutcomeResponse, Submission},
        error::ErrorCode,
        imports::dto::*,
    },
    imports::BaseFault,
};
use std::sync::Arc;
async fn app() -> (tempfile::TempDir, Server, String) {
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("plain");
    std::fs::write(&source, b"original prepared bytes").unwrap();
    let server = Server::bind(ServerConfig::new(
        "test-import-credential-at-least-32-chars".into(),
        root.path().join("library"),
    ))
    .await
    .unwrap();
    (root, server, source.to_string_lossy().into_owned())
}
fn id() -> String {
    uuid::Uuid::now_v7().to_string()
}
async fn terminal(state: &Arc<super::Shared>, task: &str) {
    let mut changes = state.changes.subscribe();
    tokio::time::timeout(std::time::Duration::from_secs(15), async {
        loop {
            if matches!(
                state.outcome(task).unwrap(),
                OutcomeResponse::Complete { .. }
            ) {
                return;
            }
            changes.changed().await.unwrap();
        }
    })
    .await
    .unwrap();
}
fn first(server: &Server) -> ImportItem {
    server.state.import_snapshot().batches[0].items[0].clone()
}
fn recovery(batch: &str, item: &ImportItem, action: ImportAction) -> ImportRecoveryRequest {
    ImportRecoveryRequest {
        request_id: id(),
        batch_id: batch.into(),
        item_id: item.item_id.clone(),
        action,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn whole_base_rollback_retains_copy_and_retry_reuses_identity_without_source() {
    let (_root, server, source) = app().await;
    *server.state.imports.base_fault.lock().unwrap() = Some(BaseFault::Rollback);
    let request = BatchImportRequest {
        request_id: id(),
        source_paths: vec![source.clone()],
    };
    let receipt = server.state.import_batch(request.clone()).unwrap();
    assert_eq!(
        server.state.task(&receipt.task_id).unwrap().operation,
        crate::api::task::TaskOperation::ImportBatch {
            batch_id: request.request_id.clone(),
            item_count: 1,
        }
    );
    assert_eq!(server.state.import_batch(request.clone()).unwrap(), receipt);
    terminal(&server.state, &receipt.task_id).await;
    let old = first(&server);
    assert_eq!(old.current.base.state, ImportStepState::Failed);
    assert!(old.current.copy_complete);
    let file = old.current.file_id.clone().unwrap();
    assert!(
        server
            .state
            .read(
                locus_file::api::FileId::from_bytes(
                    uuid::Uuid::parse_str(&file).unwrap().as_bytes()
                )
                .unwrap()
            )
            .await
            .is_err()
    );
    assert!(
        server
            .state
            .memberships_batch(vec![
                locus_core::api::EntityId::from_bytes(
                    uuid::Uuid::parse_str(old.current.entity_id.as_ref().unwrap())
                        .unwrap()
                        .as_bytes()
                )
                .unwrap()
            ])
            .await
            .unwrap()
            .iter()
            .all(|m| matches!(m, crate::api::core::dto::EntityMemberships::Missing { .. }))
    );
    std::fs::remove_file(&source).unwrap();
    let retry = recovery(&request.request_id, &old, ImportAction::Retry);
    let receipt = server.state.recover_import(retry.clone()).unwrap();
    assert_eq!(
        server.state.task(&receipt.task_id).unwrap().operation,
        crate::api::task::TaskOperation::ImportRecovery {
            batch_id: request.request_id.clone(),
            item_id: old.item_id.clone(),
        }
    );
    terminal(&server.state, &receipt.task_id).await;
    assert_eq!(server.state.recover_import(retry).unwrap(), receipt);
    let now = first(&server);
    assert!(now.current.complete);
    assert_eq!(now.current.file_id, old.current.file_id);
    assert_eq!(now.attempts[0].result, old.attempts[0].result);
}

#[tokio::test(flavor = "multi_thread")]
async fn uncertain_combined_commit_confirms_candidates_but_missing_effect_never_authorizes_recreation()
 {
    let (_root, server, source) = app().await;
    *server.state.imports.base_fault.lock().unwrap() = Some(BaseFault::Unknown);
    let request = BatchImportRequest {
        request_id: id(),
        source_paths: vec![source],
    };
    let receipt = server.state.import_batch(request.clone()).unwrap();
    terminal(&server.state, &receipt.task_id).await;
    let unknown = first(&server);
    assert_eq!(unknown.current.base.state, ImportStepState::Uncertain);
    assert!(
        server
            .state
            .recover_import(recovery(&request.request_id, &unknown, ImportAction::Retry))
            .is_err()
    );
    let receipt = server
        .state
        .recover_import(recovery(
            &request.request_id,
            &unknown,
            ImportAction::Confirm,
        ))
        .unwrap();
    terminal(&server.state, &receipt.task_id).await;
    let confirmed = first(&server);
    assert_eq!(confirmed.current.base.state, ImportStepState::Success);
    assert_eq!(confirmed.current.entity_id, unknown.current.entity_id);
    assert_eq!(
        confirmed.attempts[0].result.base.state,
        ImportStepState::Uncertain
    );
    let entity = locus_core::api::EntityId::from_bytes(
        uuid::Uuid::parse_str(confirmed.current.entity_id.as_ref().unwrap())
            .unwrap()
            .as_bytes(),
    )
    .unwrap();
    let domain = server.state.business().unwrap().clone();
    server
        .state
        .query("remove original Entity", move |task| async move {
            let mut session = domain.database.session(&task).await.unwrap();
            domain
                .kernel
                .delete_entity(&mut session, entity)
                .await
                .unwrap();
            Ok(())
        })
        .await
        .unwrap();
    let receipt = server
        .state
        .recover_import(recovery(
            &request.request_id,
            &confirmed,
            ImportAction::Retry,
        ))
        .unwrap();
    terminal(&server.state, &receipt.task_id).await;
    let conflict = first(&server);
    assert!(
        conflict
            .current
            .observation_problem
            .as_deref()
            .unwrap()
            .contains("context")
    );
    assert_eq!(conflict.current.entity_id, confirmed.current.entity_id);
}

#[tokio::test(flavor = "multi_thread")]
async fn unusable_preparation_requires_explicit_fresh_copy_and_launch_rejection_releases_ownership()
{
    let (_root, server, source) = app().await;
    *server.state.imports.base_fault.lock().unwrap() = Some(BaseFault::Rollback);
    let request = BatchImportRequest {
        request_id: id(),
        source_paths: vec![source.clone()],
    };
    let receipt = server.state.import_batch(request.clone()).unwrap();
    terminal(&server.state, &receipt.task_id).await;
    let old = first(&server);
    let internal = server.state.imports.snapshots()[0].items[0].clone();
    let progress = internal.prepared.unwrap().progress().clone();
    std::fs::remove_file(progress.root.join(progress.relative_path)).unwrap();
    let retry = recovery(&request.request_id, &old, ImportAction::Retry);
    server.state.lock().reject_next_launch = true;
    assert_eq!(
        server.state.recover_import(retry.clone()).unwrap_err().code,
        ErrorCode::LaunchRejected
    );
    assert!(first(&server).active_request_id.is_none());
    assert!(matches!(
        server.state.submission(&retry.request_id).unwrap(),
        Submission::Rejected { .. }
    ));
    let receipt = server
        .state
        .recover_import(recovery(&request.request_id, &old, ImportAction::Retry))
        .unwrap();
    terminal(&server.state, &receipt.task_id).await;
    let unusable = first(&server);
    assert_eq!(unusable.actions, vec![ImportAction::Recopy]);
    std::fs::write(source, b"new external content").unwrap();
    let receipt = server
        .state
        .recover_import(recovery(
            &request.request_id,
            &unusable,
            ImportAction::Recopy,
        ))
        .unwrap();
    terminal(&server.state, &receipt.task_id).await;
    let now = first(&server);
    assert!(now.current.complete);
    assert_ne!(now.current.file_id, old.current.file_id);
    assert_eq!(now.attempts[0].result.file_id, old.current.file_id);
}

#[tokio::test(flavor = "multi_thread")]
async fn early_item_recovery_keeps_original_batch_boundary_and_drain_owns_continuation() {
    let (root, server, source) = app().await;
    let missing = root
        .path()
        .join("initially-missing")
        .to_string_lossy()
        .into_owned();
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    *server.state.imports.pause_source.lock().unwrap() =
        Some((source.clone(), entered.clone(), release.clone()));
    let batch = BatchImportRequest {
        request_id: id(),
        source_paths: vec![missing.clone(), source],
    };
    let original = server.state.import_batch(batch.clone()).unwrap();
    entered.notified().await;
    let ready = first(&server);
    assert!(ready.active_request_id.is_none());
    assert!(!server.state.import_snapshot().batches[0].original_ended);
    std::fs::write(&missing, b"recovery input").unwrap();
    let recovering = Arc::new(tokio::sync::Notify::new());
    let release_recovery = Arc::new(tokio::sync::Notify::new());
    *server.state.imports.pause_source.lock().unwrap() =
        Some((missing, recovering.clone(), release_recovery.clone()));
    let retry = recovery(&batch.request_id, &ready, ImportAction::Recopy);
    let continuation = server.state.recover_import(retry.clone()).unwrap();
    recovering.notified().await;
    assert_eq!(
        server.state.recover_import(retry.clone()).unwrap(),
        continuation
    );
    assert_eq!(
        server
            .state
            .recover_import(recovery(&batch.request_id, &ready, ImportAction::Recopy))
            .unwrap_err()
            .code,
        ErrorCode::RequestConflict
    );
    assert_eq!(server.state.import_snapshot().batches[0].items.len(), 2);
    assert_eq!(first(&server).attempts[0].result, ready.attempts[0].result);
    let closing = server.state.close();
    assert_eq!(closing.active_operations, "2");
    assert_eq!(server.state.import_batch(batch.clone()).unwrap(), original);
    assert_eq!(server.state.recover_import(retry).unwrap(), continuation);
    assert_eq!(
        server
            .state
            .import_batch(BatchImportRequest {
                request_id: id(),
                source_paths: batch.source_paths
            })
            .unwrap_err()
            .code,
        ErrorCode::AdmissionClosed
    );
    release.notify_one();
    terminal(&server.state, &original.task_id).await;
    assert!(server.state.import_snapshot().batches[0].original_ended);
    assert_eq!(server.state.status().active_operations, "1");
    release_recovery.notify_one();
    terminal(&server.state, &continuation.task_id).await;
    server.state.wait_drained().await;
    assert!(first(&server).current.complete);
    assert_eq!(first(&server).attempts[0].result, ready.attempts[0].result);
}

#[tokio::test(flavor = "multi_thread")]
async fn failed_confirmation_preserves_uncertainty_and_current_interpretation_evidence_unblocks_preview()
 {
    let (_root, server, source) = app().await;
    image::RgbaImage::from_pixel(8, 4, image::Rgba([100, 40, 20, 255]))
        .save_with_format(&source, image::ImageFormat::Png)
        .unwrap();
    *server.state.imports.base_fault.lock().unwrap() = Some(BaseFault::Unknown);
    let batch = BatchImportRequest {
        request_id: id(),
        source_paths: vec![source],
    };
    let receipt = server.state.import_batch(batch.clone()).unwrap();
    terminal(&server.state, &receipt.task_id).await;
    let old = first(&server);
    *server.state.imports.fail_session.lock().unwrap() = true;
    let receipt = server
        .state
        .recover_import(recovery(&batch.request_id, &old, ImportAction::Confirm))
        .unwrap();
    terminal(&server.state, &receipt.task_id).await;
    let failed = first(&server);
    assert_eq!(failed.current.base.state, ImportStepState::Uncertain);
    assert!(failed.current.observation_problem.is_some());
    assert_eq!(failed.actions, vec![ImportAction::Confirm]);
    let receipt = server
        .state
        .recover_import(recovery(&batch.request_id, &failed, ImportAction::Confirm))
        .unwrap();
    terminal(&server.state, &receipt.task_id).await;
    *server.state.imports.unknown_interpretation.lock().unwrap() = true;
    let receipt = server
        .state
        .recover_import(recovery(
            &batch.request_id,
            &first(&server),
            ImportAction::Retry,
        ))
        .unwrap();
    terminal(&server.state, &receipt.task_id).await;
    let unknown = first(&server);
    assert_eq!(
        unknown.current.kinds[0].interpretation.state,
        ImportStepState::Uncertain
    );
    let receipt = server
        .state
        .recover_import(recovery(&batch.request_id, &unknown, ImportAction::Confirm))
        .unwrap();
    terminal(&server.state, &receipt.task_id).await;
    let observed = first(&server);
    assert_eq!(
        observed.current.kinds[0].interpretation.state,
        ImportStepState::Success
    );
    assert!(
        observed.current.kinds[0]
            .interpretation
            .reason
            .as_ref()
            .unwrap()
            .contains("original attempt")
    );
    let receipt = server
        .state
        .recover_import(recovery(&batch.request_id, &observed, ImportAction::Retry))
        .unwrap();
    terminal(&server.state, &receipt.task_id).await;
    let done = first(&server);
    assert!(done.current.complete);
    assert_eq!(done.current.file_id, old.current.file_id);
    assert_eq!(
        done.attempts[3].result.kinds[0].interpretation.state,
        ImportStepState::Uncertain
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn original_context_restored_externally_can_retry_preview_without_reinterpreting() {
    let (_root, server, source) = app().await;
    image::RgbaImage::from_pixel(8, 4, image::Rgba([100, 40, 20, 255]))
        .save_with_format(&source, image::ImageFormat::Png)
        .unwrap();
    *server.state.imports.fail_preview.lock().unwrap() = true;
    let batch = BatchImportRequest {
        request_id: id(),
        source_paths: vec![source.clone()],
    };
    let receipt = server.state.import_batch(batch.clone()).unwrap();
    terminal(&server.state, &receipt.task_id).await;
    let initial = first(&server);
    let original = server.state.imports.snapshots()[0].items[0].current.clone();
    assert!(original.kinds[0].interpretation.success());
    *server.state.imports.fail_session.lock().unwrap() = true;
    let receipt = server
        .state
        .recover_import(recovery(&batch.request_id, &initial, ImportAction::Retry))
        .unwrap();
    terminal(&server.state, &receipt.task_id).await;
    assert_eq!(
        first(&server).current.kinds[0].interpretation,
        initial.current.kinds[0].interpretation
    );
    let d = server.state.business().unwrap().clone();
    let original_for_change = original.clone();
    let replacement = server
        .state
        .query(
            "replace File membership externally",
            move |task| async move {
                let mut s = d.database.session(&task).await.unwrap();
                let entity = original_for_change.entity.unwrap();
                d.kernel
                    .detach(
                        &mut s,
                        locus_core::api::Membership {
                            entity,
                            kind: locus_file::api::FILE_KIND,
                            component: original_for_change.file.unwrap().component(),
                        },
                    )
                    .await
                    .unwrap();
                let file = d.files.admit(&d.kernel, &mut s, source).await.unwrap();
                let membership = locus_core::api::Membership {
                    entity,
                    kind: locus_file::api::FILE_KIND,
                    component: file.id.component(),
                };
                d.kernel.attach(&mut s, membership).await.unwrap();
                Ok(membership)
            },
        )
        .await
        .unwrap();
    let receipt = server
        .state
        .recover_import(recovery(
            &batch.request_id,
            &first(&server),
            ImportAction::Retry,
        ))
        .unwrap();
    terminal(&server.state, &receipt.task_id).await;
    let conflict = first(&server);
    assert!(conflict.current.observation_problem.is_some());
    assert_eq!(
        conflict.current.kinds[0].establishment.state,
        ImportStepState::Success
    );
    let d = server.state.business().unwrap().clone();
    let restore = original.clone();
    server
        .state
        .query(
            "restore File membership externally",
            move |task| async move {
                let mut s = d.database.session(&task).await.unwrap();
                d.kernel.detach(&mut s, replacement).await.unwrap();
                d.kernel
                    .attach(
                        &mut s,
                        locus_core::api::Membership {
                            entity: restore.entity.unwrap(),
                            kind: locus_file::api::FILE_KIND,
                            component: restore.file.unwrap().component(),
                        },
                    )
                    .await
                    .unwrap();
                Ok(())
            },
        )
        .await
        .unwrap();
    let receipt = server
        .state
        .recover_import(recovery(&batch.request_id, &conflict, ImportAction::Retry))
        .unwrap();
    terminal(&server.state, &receipt.task_id).await;
    let done = server.state.imports.snapshots()[0].items[0].current.clone();
    assert!(done.complete());
    assert_eq!(done.kinds[0].revision, original.kinds[0].revision);
    assert_eq!(done.kinds[0].component, original.kinds[0].component);
    assert_eq!(done.file, original.file);
}
