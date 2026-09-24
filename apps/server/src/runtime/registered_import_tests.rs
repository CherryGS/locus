use super::{Server, ServerConfig, Shared};
use crate::{
    api::{
        dto::{OutcomeResponse, Submission, TaskOutcome},
        file::dto::ImportRequest,
        imports::dto::*,
    },
    imports::BaseFault,
};
use std::sync::Arc;
fn id() -> String {
    uuid::Uuid::now_v7().to_string()
}
async fn app() -> (tempfile::TempDir, Server, String) {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("plain.txt");
    std::fs::write(&path, b"retained ordinary input").unwrap();
    let server = Server::bind(ServerConfig::new(
        "registered-tests-credential-32-characters".into(),
        root.path().join("library"),
    ))
    .await
    .unwrap();
    (root, server, path.to_string_lossy().into_owned())
}
async fn terminal(s: &Arc<Shared>, task: &str) -> TaskOutcome {
    let mut changes = s.changes.subscribe();
    tokio::time::timeout(std::time::Duration::from_secs(20), async {
        loop {
            if let OutcomeResponse::Complete { outcome } = s.outcome(task).unwrap() {
                return outcome;
            }
            changes.changed().await.unwrap();
        }
    })
    .await
    .unwrap()
}
async fn accepted(
    s: &Arc<Shared>,
    request: &RegisteredImportRequest,
) -> Result<crate::api::dto::Receipt, crate::api::error::ApiError> {
    let mut changes = s.changes.subscribe();
    s.registered_import(request.clone())?;
    tokio::time::timeout(std::time::Duration::from_secs(20), async {
        loop {
            match s.submission(&request.request_id)? {
                Submission::Accepted { receipt } => return Ok(receipt),
                Submission::Rejected { error } => return Err(error),
                Submission::AdmissionPending => (),
                _ => panic!("wrong submission"),
            }
            changes.changed().await.unwrap();
        }
    })
    .await
    .unwrap()
}
async fn file(s: &Arc<Shared>, path: String) -> String {
    let receipt = s
        .import(ImportRequest {
            request_id: id(),
            source_path: path,
        })
        .unwrap();
    let TaskOutcome::Imported { file } = terminal(s, &receipt.task_id).await else {
        panic!("File admission");
    };
    file.file_id
}
fn request(file: Option<String>, twitter: bool) -> RegisteredImportRequest {
    RegisteredImportRequest {
        request_id: id(),
        items: vec![RegisteredImportItem {
            bilibili: None,
            cover_file_id: None,
            file_id: file,
            twitter: twitter.then(|| crate::api::twitter::dto::TwitterSnapshot {
                post_id: Some("123456789".into()),
                text: Some(String::new()),
                hashtags: Some(vec![]),
                ..Default::default()
            }),
        }],
    }
}
fn batch_id(s: &Shared, request: &str) -> String {
    s.import_snapshot()
        .batches
        .into_iter()
        .find(|b| b.original_request_id == request)
        .unwrap()
        .batch_id
}
fn item(s: &Shared, batch: &str) -> ImportItem {
    s.import_snapshot()
        .batches
        .into_iter()
        .find(|b| b.original_request_id == batch)
        .unwrap()
        .items
        .remove(0)
}
async fn recover(s: &Arc<Shared>, batch: &str, action: ImportAction) -> ImportItem {
    let receipt = s
        .recover_import(ImportRecoveryRequest {
            request_id: id(),
            batch_id: batch_id(s, batch),
            item_id: item(s, batch).item_id,
            action,
        })
        .unwrap();
    terminal(s, &receipt.task_id).await;
    item(s, batch)
}

#[tokio::test(flavor = "multi_thread")]
async fn registered_forms_duplicate_binding_and_rejections() {
    let (_root, server, path) = app().await;
    let s = &server.state;
    for (wants_file, twitter) in [(false, true), (true, false), (true, true)] {
        let file = if wants_file {
            Some(file(s, path.clone()).await)
        } else {
            None
        };
        let request = request(file.clone(), twitter);
        let (a, b) = tokio::join!(accepted(s, &request), accepted(s, &request));
        assert_eq!(a, b);
        let receipt = a.unwrap();
        terminal(s, &receipt.task_id).await;
        let result = item(s, &request.request_id);
        assert_eq!(result.current.overall, Some(ImportOverall::Success));
        assert_eq!(result.current.confirmed_file_id, file);
        assert_eq!(result.current.kinds.is_empty(), !wants_file);
        assert!(result.current.confirmed_entity_id.is_some());
        assert_eq!(
            accepted(s, &request).await.unwrap(),
            receipt,
            "duplicate after attachment must recover original"
        );
        let mut changed = request.clone();
        changed.items[0].twitter = None;
        if !twitter {
            changed.items[0].twitter = Some(Default::default());
        }
        assert!(s.registered_import(changed).is_err());
        if let Some(file) = file {
            assert!(accepted(s, &self::request(Some(file), true)).await.is_err());
        }
    }
    for request in [
        request(None, false),
        request(Some(id()), false),
        RegisteredImportRequest {
            request_id: id(),
            items: vec![],
        },
        RegisteredImportRequest {
            request_id: id(),
            items: vec![RegisteredImportItem {
                bilibili: None,
                cover_file_id: None,
                file_id: None,
                twitter: Some(Default::default()),
            }],
        },
    ] {
        assert!(accepted(s, &request).await.is_err());
        assert!(matches!(
            s.submission(&request.request_id).unwrap(),
            Submission::Rejected { .. }
        ));
    }
    assert_eq!(s.import_snapshot().batches.len(), 3);
}

#[tokio::test(flavor = "multi_thread")]
async fn source_first_and_file_first_recovery_preserve_independent_effects() {
    let (_root, server, path) = app().await;
    let s = &server.state;
    for source_first in [false, true] {
        let file = file(s, path.clone()).await;
        let request = request(Some(file.clone()), true);
        if source_first {
            *s.imports.base_fault.lock().unwrap() = Some(BaseFault::Rollback);
        } else {
            *s.imports.source_fault.lock().unwrap() = Some(BaseFault::Rollback);
        }
        let receipt = accepted(s, &request).await.unwrap();
        terminal(s, &receipt.task_id).await;
        let old = item(s, &request.request_id);
        assert_eq!(old.current.overall, Some(ImportOverall::Failure));
        assert_eq!(old.current.confirmed_file_id, Some(file));
        assert!(old.current.confirmed_entity_id.is_some());
        assert_eq!(
            old.current.twitter.state == ImportStepState::Success,
            source_first
        );
        let now = recover(s, &request.request_id, ImportAction::Retry).await;
        assert_eq!(now.current.overall, Some(ImportOverall::Success));
        assert_eq!(now.current.entity_id, old.current.entity_id);
        assert_eq!(now.current.file_id, old.current.file_id);
        assert_eq!(now.attempts[0], old.attempts[0]);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn uncertain_source_and_association_confirm_exact_original_observation() {
    let (_root, server, path) = app().await;
    let s = &server.state;
    for association in [false, true] {
        let request = request(Some(file(s, path.clone()).await), true);
        if association {
            *s.imports.association_fault.lock().unwrap() = Some(BaseFault::Unknown);
        } else {
            *s.imports.source_fault.lock().unwrap() = Some(BaseFault::Unknown);
        }
        let receipt = accepted(s, &request).await.unwrap();
        terminal(s, &receipt.task_id).await;
        let old = item(s, &request.request_id);
        assert_eq!(old.actions, vec![ImportAction::Confirm]);
        let confirmed = recover(s, &request.request_id, ImportAction::Confirm).await;
        assert_eq!(confirmed.current.twitter_id, old.current.twitter_id);
        assert_eq!(confirmed.current.twitter.state, ImportStepState::Success);
        let now = if confirmed.current.complete {
            confirmed
        } else {
            recover(s, &request.request_id, ImportAction::Retry).await
        };
        assert_eq!(now.current.overall, Some(ImportOverall::Success));
        assert_eq!(now.attempts[0], old.attempts[0]);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn pending_validation_is_supervised_and_final_close_gate_rejects_without_effects() {
    let (_root, server, path) = app().await;
    let s = &server.state;
    let request = request(Some(file(s, path).await), true);
    let database = s.library.database.clone();
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = tokio::sync::oneshot::channel();
    let holder = s
        .queue
        .submit("hold DB for validation", move |task| async move {
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
    assert!(matches!(
        s.registered_import(request.clone()).unwrap(),
        Submission::AdmissionPending
    ));
    assert!(matches!(
        s.registered_import(request.clone()).unwrap(),
        Submission::AdmissionPending
    ));
    let mut changed = request.clone();
    changed.items[0].twitter = None;
    assert!(s.registered_import(changed).is_err());
    s.close();
    assert!(!*s.drained.borrow());
    release_tx.send(()).unwrap();
    holder.result().await.unwrap();
    s.wait_drained().await;
    assert!(
        matches!(s.submission(&request.request_id).unwrap(),Submission::Rejected { error } if error.code==crate::api::error::ErrorCode::AdmissionClosed)
    );
    assert!(s.import_snapshot().batches.is_empty());
    assert!(matches!(
        s.registered_import(request).unwrap(),
        Submission::Rejected { .. }
    ));
}

#[tokio::test(flavor = "multi_thread")]
async fn uncertain_registration_confirms_without_recopy_and_retains_original_failure() {
    let (_root, server, path) = app().await;
    let s = &server.state;
    *s.imports.registration_fault.lock().unwrap() = Some(BaseFault::Unknown);
    let request = BatchImportRequest {
        request_id: id(),
        source_paths: vec![path.clone()],
    };
    let receipt = s.import_batch(request.clone()).unwrap();
    terminal(s, &receipt.task_id).await;
    let old = item(s, &request.request_id);
    assert_eq!(old.current.registration.state, ImportStepState::Uncertain);
    assert_eq!(old.actions, vec![ImportAction::Confirm]);
    std::fs::remove_file(path).unwrap();
    let confirmed = recover(s, &request.request_id, ImportAction::Confirm).await;
    assert_eq!(
        confirmed.current.registration.state,
        ImportStepState::Success
    );
    let now = recover(s, &request.request_id, ImportAction::Retry).await;
    assert!(now.current.complete);
    assert_eq!(now.current.file_id, old.current.file_id);
    assert_eq!(now.attempts[0], old.attempts[0]);
}

#[tokio::test(flavor = "multi_thread")]
async fn revised_capture_blocks_association_and_never_replaces_the_snapshot() {
    let (_root, server, path) = app().await;
    let s = &server.state;
    let request = request(Some(file(s, path).await), true);
    *s.imports.association_fault.lock().unwrap() = Some(BaseFault::Rollback);
    let receipt = accepted(s, &request).await.unwrap();
    terminal(s, &receipt.task_id).await;
    let old = item(s, &request.request_id);
    let internal = s
        .imports
        .item(&batch_id(s, &request.request_id), &old.item_id)
        .unwrap();
    let twitter = internal.current.twitter_id.unwrap();
    let domain = s.business().unwrap().clone();
    s.query("explicitly replace test capture", move |task| async move {
        let mut session = domain.database.session(&task).await.unwrap();
        let replacement = locus_twitter::api::TwitterSnapshot {
            post_id: Some("987654321".into()),
            ..Default::default()
        };
        assert!(matches!(
            domain
                .twitter
                .replace(&mut session, twitter, 0, replacement)
                .await
                .unwrap(),
            locus_twitter::api::WriteOutcome::Accepted(_)
        ));
        Ok(())
    })
    .await
    .unwrap();
    let now = recover(s, &request.request_id, ImportAction::Retry).await;
    assert_eq!(now.current.overall, Some(ImportOverall::Failure));
    assert!(
        now.current
            .observation_problem
            .unwrap()
            .contains("observation changed")
    );
    assert_eq!(now.current.twitter_id, old.current.twitter_id);
    assert_eq!(now.attempts[0], old.attempts[0]);
}

#[tokio::test(flavor = "multi_thread")]
async fn competing_items_attach_once_and_rejected_request_stays_rejected_after_detach() {
    let (_root, server, path) = app().await;
    let s = &server.state;
    let file = file(s, path).await;
    let mut request = request(Some(file.clone()), false);
    request.items.push(request.items[0].clone());
    let receipt = accepted(s, &request).await.unwrap();
    terminal(s, &receipt.task_id).await;
    let batch = s
        .import_snapshot()
        .batches
        .into_iter()
        .find(|b| b.original_request_id == request.request_id)
        .unwrap();
    assert_eq!(batch.items.iter().filter(|i| i.current.complete).count(), 1);
    assert_eq!(
        batch
            .items
            .iter()
            .filter(|i| i.current.confirmed_entity_id.is_some())
            .count(),
        1
    );
    let rejected = self::request(Some(file.clone()), true);
    assert!(accepted(s, &rejected).await.is_err());
    let domain = s.business().unwrap().clone();
    let file =
        locus_file::api::FileId::from_bytes(uuid::Uuid::parse_str(&file).unwrap().as_bytes())
            .unwrap();
    s.query("detach test File", move |task| async move {
        let mut session = domain.database.session(&task).await.unwrap();
        let m = domain
            .kernel
            .attachment(&mut session, file.component())
            .await
            .unwrap()
            .unwrap();
        domain.kernel.detach(&mut session, m).await.unwrap();
        Ok(())
    })
    .await
    .unwrap();
    assert!(accepted(s, &rejected).await.is_err());
    let fresh = self::request(Some(file.to_string()), false);
    let receipt = accepted(s, &fresh).await.unwrap();
    terminal(s, &receipt.task_id).await;
    assert!(item(s, &fresh.request_id).current.complete);
}

#[tokio::test(flavor = "multi_thread")]
async fn later_content_checks_retained_attachment_inside_its_mutation_unit() {
    let (_root, server, path) = app().await;
    let s = &server.state;
    for source_first in [false, true] {
        let request = request(Some(file(s, path.clone()).await), true);
        if source_first {
            *s.imports.base_fault.lock().unwrap() = Some(BaseFault::Rollback);
        } else {
            *s.imports.source_fault.lock().unwrap() = Some(BaseFault::Rollback);
        }
        let receipt = accepted(s, &request).await.unwrap();
        terminal(s, &receipt.task_id).await;
        let old = item(s, &request.request_id);
        let internal = s
            .imports
            .item(&batch_id(s, &request.request_id), &old.item_id)
            .unwrap();
        let entered = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        *s.imports.pause_content.lock().unwrap() = Some((entered.clone(), release.clone()));
        let recovery = s
            .recover_import(ImportRecoveryRequest {
                request_id: id(),
                batch_id: batch_id(s, &request.request_id),
                item_id: old.item_id.clone(),
                action: ImportAction::Retry,
            })
            .unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(10), entered.notified())
            .await
            .unwrap();
        let domain = s.business().unwrap().clone();
        let component = if source_first {
            internal.current.twitter_id.unwrap().component()
        } else {
            internal.current.file.unwrap().component()
        };
        s.query(
            "intervene between import observation and write",
            move |task| async move {
                let mut session = domain.database.session(&task).await.unwrap();
                let membership = domain
                    .kernel
                    .attachment(&mut session, component)
                    .await
                    .unwrap()
                    .unwrap();
                domain
                    .kernel
                    .detach(&mut session, membership)
                    .await
                    .unwrap();
                Ok(())
            },
        )
        .await
        .unwrap();
        release.notify_one();
        terminal(s, &recovery.task_id).await;
        let now = item(s, &request.request_id);
        assert!(!now.current.complete);
        assert_eq!(now.current.effect_revision, old.current.effect_revision);
        if source_first {
            assert_ne!(now.current.file_attachment.state, ImportStepState::Success);
        } else {
            assert_ne!(now.current.twitter.state, ImportStepState::Success);
        }
        assert_eq!(now.current.entity_id, old.current.entity_id);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn confirmation_cannot_relabel_detached_confirmed_twitter_as_current_success() {
    let (_root, server, path) = app().await;
    let s = &server.state;
    for wants_file in [false, true] {
        let request = request(
            if wants_file {
                Some(file(s, path.clone()).await)
            } else {
                None
            },
            true,
        );
        let receipt = accepted(s, &request).await.unwrap();
        terminal(s, &receipt.task_id).await;
        let old = item(s, &request.request_id);
        assert!(old.current.complete);
        let internal = s
            .imports
            .item(&batch_id(s, &request.request_id), &old.item_id)
            .unwrap();
        let component = internal.current.twitter_id.unwrap().component();
        let domain = s.business().unwrap().clone();
        s.query("detach confirmed Source", move |task| async move {
            let mut session = domain.database.session(&task).await.unwrap();
            let m = domain
                .kernel
                .attachment(&mut session, component)
                .await
                .unwrap()
                .unwrap();
            domain.kernel.detach(&mut session, m).await.unwrap();
            Ok(())
        })
        .await
        .unwrap();
        let now = recover(s, &request.request_id, ImportAction::Confirm).await;
        assert!(!now.current.complete);
        assert!(
            now.current
                .observation_problem
                .unwrap()
                .contains("Twitter attachment changed")
        );
        assert_eq!(now.attempts[0], old.attempts[0]);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn changed_source_does_not_stop_independent_original_media_preview_recovery() {
    let (root, server, _) = app().await;
    let s = &server.state;
    let path = root.path().join("image.png");
    image::RgbImage::new(8, 8).save(&path).unwrap();
    let request = request(
        Some(file(s, path.to_string_lossy().into_owned()).await),
        true,
    );
    *s.imports.fail_preview.lock().unwrap() = true;
    let receipt = accepted(s, &request).await.unwrap();
    terminal(s, &receipt.task_id).await;
    let old = item(s, &request.request_id);
    assert_eq!(
        old.current.kinds[0].interpretation.state,
        ImportStepState::Success
    );
    assert_eq!(old.current.kinds[0].preview.state, ImportStepState::Failed);
    let internal = s
        .imports
        .item(&batch_id(s, &request.request_id), &old.item_id)
        .unwrap();
    let twitter = internal.current.twitter_id.unwrap();
    let revision = internal.current.twitter_revision.unwrap();
    let domain = s.business().unwrap().clone();
    s.query("replace independent Source", move |task| async move {
        let mut session = domain.database.session(&task).await.unwrap();
        domain
            .twitter
            .replace(
                &mut session,
                twitter,
                revision,
                locus_twitter::api::TwitterSnapshot {
                    post_id: Some("987654321".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        Ok(())
    })
    .await
    .unwrap();
    let now = recover(s, &request.request_id, ImportAction::Retry).await;
    assert!(now.current.observation_problem.is_some());
    assert_eq!(now.current.overall, Some(ImportOverall::Failure));
    assert_eq!(now.current.kinds[0].preview.state, ImportStepState::Success);
    assert_eq!(now.current.file_id, old.current.file_id);
    assert_eq!(now.attempts[0], old.attempts[0]);
}

#[tokio::test(flavor = "multi_thread")]
async fn registered_launch_rejection_retains_claim_without_publishing_batch() {
    let (_root, server, path) = app().await;
    let s = &server.state;
    let request = request(Some(file(s, path).await), true);
    s.lock().reject_next_launch = true;
    let rejected = accepted(s, &request).await.unwrap_err();
    assert_eq!(rejected.code, crate::api::error::ErrorCode::LaunchRejected);
    assert!(s.import_snapshot().batches.is_empty());
    assert_eq!(accepted(s, &request).await.unwrap_err(), rejected);
    s.close();
    s.wait_drained().await;
    assert_eq!(s.lock().active, 0);
}
#[tokio::test(flavor = "multi_thread")]
async fn model_success_is_reused_when_source_sibling_retries() {
    let (_root, server, path) = app().await;
    let header = b"{}";
    let mut bytes = 2u64.to_le_bytes().to_vec();
    bytes.extend(header);
    std::fs::write(&path, bytes).unwrap();
    let file = file(&server.state, path).await;
    *server.state.imports.source_fault.lock().unwrap() = Some(BaseFault::Rollback);
    let request = request(Some(file), true);
    let receipt = accepted(&server.state, &request).await.unwrap();
    terminal(&server.state, &receipt.task_id).await;
    let before = item(&server.state, &request.request_id);
    assert_eq!(before.current.twitter.state, ImportStepState::Failed);
    assert_eq!(
        before.current.model.inspection.state,
        ImportStepState::Success
    );
    let model = locus_model::api::ModelId::from_bytes(
        uuid::Uuid::parse_str(before.current.model.component_id.as_ref().unwrap())
            .unwrap()
            .as_bytes(),
    )
    .unwrap();
    let record = server.state.model_read(model).await.unwrap();
    let receipt = server
        .state
        .recover_import(ImportRecoveryRequest {
            request_id: id(),
            batch_id: batch_id(&server.state, &request.request_id),
            item_id: before.item_id.clone(),
            action: ImportAction::Retry,
        })
        .unwrap();
    terminal(&server.state, &receipt.task_id).await;
    let after = item(&server.state, &request.request_id);
    assert!(after.current.complete);
    assert_eq!(
        after.current.model.component_id,
        before.current.model.component_id
    );
    assert_eq!(server.state.model_read(model).await.unwrap(), record);
}

fn bilibili_request(main: Option<String>, cover: Option<String>) -> RegisteredImportRequest {
    RegisteredImportRequest {
        request_id: id(),
        items: vec![RegisteredImportItem {
            file_id: main,
            twitter: None,
            bilibili: Some(crate::api::bilibili::dto::BilibiliSnapshot {
                bvid: Some("BV1xx411c7mD".into()),
                title: Some("Independent captured video".into()),
                ..Default::default()
            }),
            cover_file_id: cover,
        }],
    }
}
async fn image_file(s: &Arc<Shared>, root: &std::path::Path) -> String {
    let path = root.join(format!("{}.png", id()));
    image::RgbImage::from_pixel(12, 8, image::Rgb([40, 80, 120]))
        .save(&path)
        .unwrap();
    file(s, path.to_string_lossy().into_owned()).await
}
#[tokio::test(flavor = "multi_thread")]
async fn bilibili_source_only_cover_and_distinct_providers_complete_independently() {
    let (root, server, _) = app().await;
    let s = &server.state;
    let cover = image_file(s, root.path()).await;
    let mut r = bilibili_request(None, Some(cover.clone()));
    r.items[0].twitter = Some(crate::api::twitter::dto::TwitterSnapshot {
        post_id: Some("123".into()),
        ..Default::default()
    });
    let receipt = accepted(s, &r).await.unwrap();
    terminal(s, &receipt.task_id).await;
    let first = item(s, &r.request_id);
    assert!(first.current.complete, "{:#?}", first.current);
    let b = first.current.bilibili.unwrap();
    let c = b.cover.unwrap();
    assert_eq!(b.source.state, ImportStepState::Success);
    assert_eq!(b.association.state, ImportStepState::NotRequested);
    assert_eq!(c.image.interpretation.state, ImportStepState::Success);
    assert_eq!(c.image.preview.state, ImportStepState::Success);
    assert_ne!(c.confirmed_entity_id, first.current.confirmed_entity_id);
    assert_eq!(first.current.twitter.state, ImportStepState::Success);
    let another = bilibili_request(None, Some(image_file(s, root.path()).await));
    let receipt = accepted(s, &another).await.unwrap();
    terminal(s, &receipt.task_id).await;
    let second = item(s, &another.request_id)
        .current
        .bilibili
        .unwrap()
        .cover
        .unwrap();
    assert_ne!(second.entity_id, c.entity_id);
    assert_ne!(second.file_id, c.file_id);
    let duplicate = bilibili_request(None, Some(cover));
    assert!(accepted(s, &duplicate).await.is_err());
}
#[tokio::test(flavor = "multi_thread")]
async fn bilibili_bad_cover_is_not_generic_no_match_success_and_main_proceeds() {
    let (root, server, path) = app().await;
    let s = &server.state;
    let main = image_file(s, root.path()).await;
    let cover = file(s, path).await;
    let r = bilibili_request(Some(main), Some(cover));
    let receipt = accepted(s, &r).await.unwrap();
    terminal(s, &receipt.task_id).await;
    let first = item(s, &r.request_id);
    assert!(!first.current.complete);
    assert_eq!(
        first.current.file_attachment.state,
        ImportStepState::Success
    );
    assert_eq!(
        first.current.kinds[0].preview.state,
        ImportStepState::Success
    );
    let b = first.current.bilibili.clone().unwrap();
    let c = b.cover.unwrap();
    assert_eq!(c.image.recognition.state, ImportStepState::NoMatch);
    assert_eq!(c.association.state, ImportStepState::Success);
    let retried = recover(s, &r.request_id, ImportAction::Retry).await;
    let now = retried.current.bilibili.unwrap().cover.unwrap();
    assert_eq!(now.entity_id, c.entity_id);
    assert_eq!(now.file_id, c.file_id);
    assert!(!retried.current.complete);
    assert_eq!(retried.current.entity_id, first.current.entity_id);
}
#[tokio::test(flavor = "multi_thread")]
async fn bilibili_early_source_survives_main_rollback_and_cover_unknown_retains_identity() {
    let (root, server, path) = app().await;
    let s = &server.state;
    let main = file(s, path).await;
    let cover = image_file(s, root.path()).await;
    *s.imports.base_fault.lock().unwrap() = Some(BaseFault::Rollback);
    *s.imports.bilibili_cover_fault.lock().unwrap() = Some(BaseFault::Unknown);
    let r = bilibili_request(Some(main), Some(cover));
    let receipt = accepted(s, &r).await.unwrap();
    terminal(s, &receipt.task_id).await;
    let first = item(s, &r.request_id);
    assert!(first.current.confirmed_entity_id.is_some());
    assert_eq!(first.current.file_attachment.state, ImportStepState::Failed);
    assert_eq!(
        first.current.bilibili.as_ref().unwrap().source.state,
        ImportStepState::Success
    );
    let original = first.current.bilibili.unwrap().cover.unwrap().entity_id;
    assert_eq!(first.actions, vec![ImportAction::Confirm]);
    let confirmed = recover(s, &r.request_id, ImportAction::Confirm).await;
    assert_eq!(
        confirmed
            .current
            .bilibili
            .as_ref()
            .unwrap()
            .cover
            .as_ref()
            .unwrap()
            .confirmed_entity_id,
        original
    );
    let done = recover(s, &r.request_id, ImportAction::Retry).await;
    assert!(done.current.complete, "{:#?}", done.current);
    assert_eq!(done.current.entity_id, first.current.entity_id);
    assert_eq!(
        done.current.bilibili.unwrap().cover.unwrap().entity_id,
        original
    );
}
#[tokio::test(flavor = "multi_thread")]
async fn bilibili_unknown_source_never_creates_a_second_main() {
    let (root, server, _) = app().await;
    let s = &server.state;
    let main = image_file(s, root.path()).await;
    *s.imports.bilibili_source_fault.lock().unwrap() = Some(BaseFault::Unknown);
    let r = bilibili_request(Some(main), None);
    let receipt = accepted(s, &r).await.unwrap();
    terminal(s, &receipt.task_id).await;
    let first = item(s, &r.request_id);
    assert!(first.current.confirmed_entity_id.is_none());
    assert_eq!(
        first.current.file_attachment.state,
        ImportStepState::Pending
    );
    recover(s, &r.request_id, ImportAction::Confirm).await;
    let done = recover(s, &r.request_id, ImportAction::Retry).await;
    assert!(done.current.complete, "{:#?}", done.current);
    assert_eq!(done.current.entity_id, first.current.entity_id);
    assert_eq!(
        done.current.bilibili.unwrap().component_id,
        first.current.bilibili.unwrap().component_id
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn bilibili_lost_image_failure_confirmation_permits_original_target_retry() {
    let (_root, server, path) = app().await;
    let s = &server.state;
    let cover = file(s, path).await;
    *s.imports.force_image_match.lock().unwrap() = true;
    *s.imports.unknown_interpretation.lock().unwrap() = true;
    let r = bilibili_request(None, Some(cover));
    let receipt = accepted(s, &r).await.unwrap();
    terminal(s, &receipt.task_id).await;
    let first = item(s, &r.request_id);
    assert_eq!(
        first
            .current
            .bilibili
            .as_ref()
            .unwrap()
            .cover
            .as_ref()
            .unwrap()
            .image
            .interpretation
            .state,
        ImportStepState::Uncertain
    );
    let observed = recover(s, &r.request_id, ImportAction::Confirm).await;
    let image = &observed
        .current
        .bilibili
        .as_ref()
        .unwrap()
        .cover
        .as_ref()
        .unwrap()
        .image;
    assert_eq!(image.interpretation.state, ImportStepState::Failed);
    assert!(
        image
            .interpretation
            .reason
            .as_ref()
            .unwrap()
            .contains("original attempt acceptance remains unconfirmed")
    );
    assert!(observed.actions.contains(&ImportAction::Retry));
    let retried = recover(s, &r.request_id, ImportAction::Retry).await;
    assert_eq!(
        retried
            .current
            .bilibili
            .unwrap()
            .cover
            .unwrap()
            .image
            .component_id,
        image.component_id
    );
}
#[tokio::test(flavor = "multi_thread")]
async fn bilibili_image_creation_confirmation_does_not_adopt_later_independent_write() {
    let (root, server, _) = app().await;
    let s = &server.state;
    let cover = image_file(s, root.path()).await;
    *s.imports.bilibili_image_fault.lock().unwrap() = Some(BaseFault::Unknown);
    let r = bilibili_request(None, Some(cover));
    let receipt = accepted(s, &r).await.unwrap();
    terminal(s, &receipt.task_id).await;
    let first = item(s, &r.request_id);
    let image = first
        .current
        .bilibili
        .as_ref()
        .unwrap()
        .cover
        .as_ref()
        .unwrap()
        .image
        .component_id
        .clone()
        .unwrap();
    let d = s.business().unwrap().clone();
    s.queue
        .submit("Independent Image interpretation", move |task| async move {
            let mut session = d.database.session(&task).await.unwrap();
            let component = locus_core::api::ComponentId::from_bytes(
                uuid::Uuid::parse_str(&image).unwrap().as_bytes(),
            )
            .unwrap();
            let id = locus_media::api::MediaId::Image(locus_media::api::ImageId::from_component(
                component,
            ));
            d.media
                .interpret(&d.kernel, &d.files, &mut session, id)
                .await
                .unwrap();
        })
        .unwrap()
        .result()
        .await
        .unwrap();
    let observed = recover(s, &r.request_id, ImportAction::Confirm).await;
    assert_eq!(
        observed
            .current
            .bilibili
            .unwrap()
            .cover
            .unwrap()
            .image
            .establishment
            .state,
        ImportStepState::Uncertain
    );
    assert!(
        observed
            .current
            .observation_problem
            .unwrap()
            .contains("changed before creation confirmation")
    );
}
