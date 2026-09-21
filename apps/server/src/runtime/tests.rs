use super::{Server, ServerConfig};
use crate::api::{
    core::dto::*, dto::*, error::ErrorCode, file::dto::*, media::dto::*, task::dto::*,
};
use std::sync::Arc;
use tokio::sync::{Barrier, oneshot, watch};

async fn app() -> (tempfile::TempDir, Server) {
    let root = tempfile::tempdir().unwrap();
    let config = ServerConfig::new(
        "test-credential-with-at-least-32-characters".into(),
        root.path().join("library"),
    );
    (root, Server::bind(config).await.unwrap())
}

#[tokio::test(flavor = "multi_thread")]
async fn entity_enumeration_releases_db_before_unconsumed_http_body_and_retains_no_read_entries() {
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;
    let (_root, server) = app().await;
    // Create directly inside a coordinated stage, with no mutation receipt.
    let domain = server.state.domain.clone();
    server
        .state
        .query("fixture", move |task| async move {
            let mut session = domain.database.session(&task).await.unwrap();
            domain.kernel.create_entity(&mut session).await.unwrap();
            Ok(())
        })
        .await
        .unwrap();
    let database = server.state.domain.database.clone();
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
    let request = Request::builder()
        .uri("/api/v1/entities")
        .header(
            "authorization",
            format!("Bearer {}", server.state.credential),
        )
        .header("x-locus-run", server.state.run_id.clone())
        .body(Body::empty())
        .unwrap();
    let router = server.router();
    let response = tokio::spawn(async move { router.oneshot(request).await.unwrap() });
    while server.state.lock().active == 0 {
        tokio::task::yield_now().await;
    }
    assert!(!response.is_finished());
    release_tx.send(()).unwrap();
    holder.result().await.unwrap();
    let unread = response.await.unwrap();
    assert_eq!(unread.headers()["content-length"], "16");
    // Complete another real DB read while the HTTP body's bytes remain unpolled.
    assert!(
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            server
                .state
                .memberships_batch(vec![locus_core::api::EntityId::new()])
        )
        .await
        .unwrap()
        .is_ok()
    );
    assert!(server.state.lock().requests.is_empty());
    assert!(server.state.lock().tasks.is_empty());
    assert_eq!(server.state.close().admission, AdmissionState::Drained);
    drop(unread);
}
fn request(path: &std::path::Path) -> ImportRequest {
    ImportRequest {
        request_id: uuid::Uuid::now_v7().to_string(),
        source_path: path.to_string_lossy().into_owned(),
    }
}

async fn terminal(state: &Arc<super::Shared>, id: &str) -> ImportOutcome {
    let mut changes = state.changes.subscribe();
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            if let OutcomeResponse::Complete { outcome } = state.outcome(id).unwrap() {
                return outcome;
            }
            changes.changed().await.unwrap();
        }
    })
    .await
    .unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn duplicate_claim_conflict_and_recovery_retain_one_real_copy() {
    let (root, server) = app().await;
    let source = root.path().join("original.bin");
    std::fs::write(&source, b"retained original").unwrap();
    let submission = request(&source);
    let barrier = Arc::new(Barrier::new(9));
    let mut deliveries = Vec::new();
    for _ in 0..8 {
        let (state, submission, barrier) =
            (server.state.clone(), submission.clone(), barrier.clone());
        deliveries.push(tokio::spawn(async move {
            barrier.wait().await;
            state.import(submission).unwrap()
        }));
    }
    barrier.wait().await;
    let first = deliveries.remove(0).await.unwrap();
    for delivery in deliveries {
        assert_eq!(delivery.await.unwrap(), first);
    }
    let mut conflict = submission.clone();
    conflict.source_path.push('x');
    assert_eq!(
        server.state.import(conflict).unwrap_err().code,
        ErrorCode::RequestConflict
    );
    let ImportOutcome::Imported { file } = terminal(&server.state, &first.task_id).await else {
        panic!("import failed")
    };
    assert_eq!(file.byte_count, "17");
    assert_eq!(server.state.lock().tasks.len(), 1);
    assert_eq!(std::fs::read(&source).unwrap(), b"retained original");
    assert_eq!(
        std::fs::read(server.state.domain.files.root().join(file.relative_path)).unwrap(),
        b"retained original"
    );
    server.state.close();
    assert_eq!(server.state.import(submission).unwrap(), first);
    assert!(matches!(
        server.state.submission(&first.request_id).unwrap(),
        Submission::Accepted { .. }
    ));
}

#[tokio::test(flavor = "multi_thread")]
async fn claimed_launch_rejection_is_definite_and_recoverable() {
    let (root, server) = app().await;
    server.state.lock().reject_next_launch = true;
    let submission = request(&root.path().join("not-executed"));
    let error = server.state.import(submission.clone()).unwrap_err();
    assert_eq!(error.code, ErrorCode::LaunchRejected);
    server.state.close();
    assert_eq!(server.state.import(submission.clone()).unwrap_err(), error);
    assert_eq!(
        server.state.submission(&submission.request_id).unwrap(),
        Submission::Rejected { error }
    );
    assert_eq!(server.state.lock().tasks.len(), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn direct_response_loss_drain_waits_for_blocking_worker_and_between_stages() {
    let (_root, server) = app().await;
    let (started_tx, started_rx) = oneshot::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let (between_tx, between_rx) = oneshot::channel();
    let (continue_tx, continue_rx) = oneshot::channel();
    let (completed_tx, completed_rx) = oneshot::channel();
    let receiver = server
        .state
        .direct("direct operation", move |task| async move {
            let stage = task.enter("protected blocking", &[]).await.unwrap();
            let worker = stage.spawn_blocking(move |_| {
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
            });
            worker.await.unwrap();
            drop(stage);
            between_tx.send(()).unwrap();
            continue_rx.await.unwrap();
            let _next = task.enter("continuation", &[]).await.unwrap();
            completed_tx.send(()).unwrap();
        })
        .unwrap();
    drop(receiver); // actual HTTP consumer loss must not cancel supervision
    started_rx.await.unwrap();
    assert!(server.state.snapshot().tasks.is_empty());
    assert_eq!(server.state.close().admission, AdmissionState::Draining);
    assert!(!*server.state.drained.borrow());
    release_tx.send(()).unwrap();
    between_rx.await.unwrap();
    assert!(!*server.state.drained.borrow());
    continue_tx.send(()).unwrap();
    completed_rx.await.unwrap();
    server.state.wait_drained().await;
    assert_eq!(server.state.status().active_operations, "0");
}

#[tokio::test(flavor = "multi_thread")]
async fn abandoned_body_still_waits_for_actual_protected_worker() {
    let (_root, server) = app().await;
    let (started_tx, started_rx) = oneshot::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    drop(
        server
            .state
            .direct("body finished", move |task| async move {
                let stage = task.enter("worker outlives body", &[]).await.unwrap();
                drop(stage.spawn_blocking(move |_| {
                    started_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                }));
            })
            .unwrap(),
    );
    started_rx.await.unwrap();
    assert_eq!(server.state.close().admission, AdmissionState::Draining);
    assert!(!*server.state.drained.borrow());
    release_tx.send(()).unwrap();
    server.state.wait_drained().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn read_uses_shared_database_gate_and_survives_handler_loss() {
    let (root, server) = app().await;
    let source = root.path().join("original");
    std::fs::write(&source, b"db").unwrap();
    let receipt = server.state.import(request(&source)).unwrap();
    let ImportOutcome::Imported { file } = terminal(&server.state, &receipt.task_id).await else {
        panic!("import")
    };
    let id = locus_file::api::FileId::from_bytes(
        uuid::Uuid::parse_str(&file.file_id).unwrap().as_bytes(),
    )
    .unwrap();
    let database = server.state.domain.database.clone();
    let (locked_tx, locked_rx) = oneshot::channel();
    let (release_tx, release_rx) = oneshot::channel();
    let holder = server
        .state
        .queue
        .submit("hold actual DB stage", move |task| async move {
            let mut session = database.session(&task).await.unwrap();
            session
                .transaction::<_, locus_store::api::StoreError, _>(move |_context| {
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
    let state = server.state.clone();
    let reader = tokio::spawn(async move { state.read(id).await });
    // Wait for admission, not for a guessed database delay.
    while server.state.lock().active == 0 {
        tokio::task::yield_now().await;
    }
    reader.abort();
    let _ = reader.await;
    assert_eq!(server.state.close().admission, AdmissionState::Draining);
    assert!(!*server.state.drained.borrow());
    release_tx.send(()).unwrap();
    holder.result().await.unwrap();
    server.state.wait_drained().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn concurrent_close_and_new_claim_have_one_atomic_order() {
    for _ in 0..12 {
        let (root, server) = app().await;
        let submission = request(&root.path().join("missing"));
        let barrier = Arc::new(Barrier::new(3));
        let (state, start, input) = (server.state.clone(), barrier.clone(), submission.clone());
        let import = tokio::spawn(async move {
            start.wait().await;
            state.import(input)
        });
        let (state, start) = (server.state.clone(), barrier.clone());
        let close = tokio::spawn(async move {
            start.wait().await;
            state.close()
        });
        barrier.wait().await;
        let accepted = import.await.unwrap();
        close.await.unwrap();
        match accepted {
            Ok(receipt) => {
                terminal(&server.state, &receipt.task_id).await;
                assert_eq!(server.state.import(submission).unwrap(), receipt);
            }
            Err(error) => {
                assert_eq!(error.code, ErrorCode::AdmissionClosed);
                assert!(server.state.lock().requests.is_empty());
            }
        }
        server.state.wait_drained().await;
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn queued_public_import_remains_recoverable_during_drain() {
    let (root, server) = app().await;
    let source = root.path().join("queued-original");
    std::fs::write(&source, b"queued").unwrap();
    let database = server.state.domain.database.clone();
    let (locked_tx, locked_rx) = oneshot::channel();
    let (release_tx, release_rx) = oneshot::channel();
    let holder = server
        .state
        .queue
        .submit("database barrier", move |task| async move {
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
    let submission = request(&source);
    let receipt = server.state.import(submission.clone()).unwrap();
    let mut changes = server.state.changes.subscribe();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while server.state.task(&receipt.task_id).unwrap().state != PublicTaskState::Waiting {
            changes.changed().await.unwrap();
        }
    })
    .await
    .unwrap();
    assert_eq!(server.state.close().admission, AdmissionState::Draining);
    assert_eq!(server.state.import(submission).unwrap(), receipt);
    assert_eq!(
        server.state.outcome(&receipt.task_id).unwrap(),
        OutcomeResponse::Pending
    );
    assert!(!*server.state.drained.borrow());
    release_tx.send(()).unwrap();
    holder.result().await.unwrap();
    assert!(matches!(
        terminal(&server.state, &receipt.task_id).await,
        ImportOutcome::Imported { .. }
    ));
    server.state.wait_drained().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn active_work_does_not_impose_a_count_barrier_on_import_or_drain() {
    let (root, server) = app().await;
    let (release, waiting) = watch::channel(false);
    let mut active = Vec::new();
    // Exceed the removed 64-operation cap while keeping actual work alive.
    for _ in 0..65 {
        let mut waiting = waiting.clone();
        active.push(
            server
                .state
                .direct("wait for release", move |_| async move {
                    waiting.wait_for(|released| *released).await.unwrap();
                })
                .unwrap(),
        );
    }
    assert_eq!(server.state.status().active_operations, "65");
    let source = root.path().join("original");
    std::fs::write(&source, b"accepted while busy").unwrap();
    let submission = request(&source);
    let receipt = server.state.import(submission.clone()).unwrap();
    assert!(matches!(
        terminal(&server.state, &receipt.task_id).await,
        ImportOutcome::Imported { .. }
    ));
    assert_eq!(server.state.close().admission, AdmissionState::Draining);
    assert_eq!(server.state.import(submission).unwrap(), receipt);
    release.send(true).unwrap();
    for operation in active {
        operation.await.unwrap().unwrap();
    }
    server.state.wait_drained().await;
    assert_eq!(server.state.status().active_operations, "0");
}

#[tokio::test(flavor = "multi_thread")]
async fn imports_continue_beyond_old_retention_cap_without_losing_prior_results() {
    let (root, server) = app().await;
    let source = root.path().join("original");
    std::fs::write(&source, b"small import").unwrap();
    let first_request = request(&source);
    let first = server.state.import(first_request.clone()).unwrap();
    let first_outcome = terminal(&server.state, &first.task_id).await;
    assert!(matches!(first_outcome, ImportOutcome::Imported { .. }));
    // Exercise real copy/registration past the former cumulative limit. Completed
    // submissions stay recoverable without preventing another deliberate import.
    tokio::time::timeout(std::time::Duration::from_secs(60), async {
        for _ in 0..1024 {
            let receipt = server.state.import(request(&source)).unwrap();
            assert!(matches!(
                terminal(&server.state, &receipt.task_id).await,
                ImportOutcome::Imported { .. }
            ));
        }
    })
    .await
    .unwrap();
    assert_eq!(server.state.snapshot().tasks.len(), 1025);
    assert_eq!(server.state.import(first_request).unwrap(), first);
    assert_eq!(
        server.state.outcome(&first.task_id).unwrap(),
        OutcomeResponse::Complete {
            outcome: first_outcome
        }
    );
    assert_eq!(std::fs::read(source).unwrap(), b"small import");
    server.close_admission();
    server.state.wait_drained().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn lost_direct_mutation_is_pending_then_recovered_after_drain_and_launch_failure() {
    let (_root, server) = app().await;
    let database = server.state.domain.database.clone();
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
    let request_id = id.clone();
    let state = server.state.clone();
    let delivery = tokio::spawn(async move { state.create_entity(request_id).await });
    while server.state.lock().active == 0 {
        tokio::task::yield_now().await;
    }
    assert_eq!(
        server.state.submission(&id).unwrap(),
        Submission::DirectPending
    );
    delivery.abort();
    let _ = delivery.await;
    assert_eq!(server.state.close().admission, AdmissionState::Draining);
    assert!(server.state.snapshot().tasks.is_empty());
    release_tx.send(()).unwrap();
    holder.result().await.unwrap();
    server.state.wait_drained().await;
    let recovered = server.state.create_entity(id.clone()).await.unwrap();
    assert!(matches!(recovered, MutationOutcome::EntityCreated { .. }));
    assert_eq!(
        server.state.submission(&id).unwrap(),
        Submission::DirectComplete { outcome: recovered }
    );
    let (_root, server) = app().await;
    server.state.lock().reject_next_launch = true;
    let id = uuid::Uuid::now_v7().to_string();
    let error = server.state.create_entity(id.clone()).await.unwrap_err();
    server.state.close();
    assert_eq!(
        server.state.create_entity(id.clone()).await.unwrap_err(),
        error
    );
    assert_eq!(
        server.state.submission(&id).unwrap(),
        Submission::Rejected { error }
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn media_and_membership_recovery_retains_one_mutation_and_task_claim() {
    let (_root, server) = app().await;
    let request = CreateMedia {
        request_id: uuid::Uuid::now_v7().to_string(),
        kind: MediaKind::Image,
    };
    let (a, b) = tokio::join!(
        server.state.create_media(request.clone()),
        server.state.create_media(request.clone())
    );
    assert_eq!(a, b);
    let MutationOutcome::MediaCreated { target, kind_id } = a.unwrap() else {
        panic!("create")
    };
    let MutationOutcome::EntityCreated { entity_id } = server
        .state
        .create_entity(uuid::Uuid::now_v7().to_string())
        .await
        .unwrap()
    else {
        panic!("entity")
    };
    let membership = Membership {
        entity_id: entity_id.clone(),
        kind_id: kind_id.clone(),
        component_id: target.component_id.clone(),
    };
    let core = locus_core::api::Membership {
        entity: locus_core::api::EntityId::from_bytes(
            uuid::Uuid::parse_str(&entity_id).unwrap().as_bytes(),
        )
        .unwrap(),
        kind: locus_core::api::KindId::from_uuid(uuid::Uuid::parse_str(&kind_id).unwrap()),
        component: locus_core::api::ComponentId::from_bytes(
            uuid::Uuid::parse_str(&target.component_id)
                .unwrap()
                .as_bytes(),
        )
        .unwrap(),
    };
    let request = ChangeMembership {
        request_id: uuid::Uuid::now_v7().to_string(),
        membership,
    };
    let (a, b) = tokio::join!(
        server.state.membership(request.clone(), core, true),
        server.state.membership(request.clone(), core, true)
    );
    assert_eq!(a.unwrap(), MutationOutcome::Attached);
    assert_eq!(b.unwrap(), MutationOutcome::Attached);
    assert_eq!(
        server
            .state
            .membership(request.clone(), core, false)
            .await
            .unwrap_err()
            .code,
        ErrorCode::RequestConflict
    );
    let mut detach = request.clone();
    detach.request_id = uuid::Uuid::now_v7().to_string();
    let (a, b) = tokio::join!(
        server.state.membership(detach.clone(), core, false),
        server.state.membership(detach.clone(), core, false)
    );
    assert_eq!(a.unwrap(), MutationOutcome::Detached { removed: true });
    assert_eq!(b.unwrap(), MutationOutcome::Detached { removed: true });
    let media_id = locus_media::api::ImageId::from_component(core.component).into();
    let input = InterpretRequest {
        request_id: uuid::Uuid::now_v7().to_string(),
        target: target.clone(),
    };
    let a = server.state.interpret(input.clone(), media_id).unwrap();
    let b = server.state.interpret(input.clone(), media_id).unwrap();
    assert_eq!(a, b);
    assert!(matches!(
        terminal(&server.state, &a.task_id).await,
        ImportOutcome::Interpreted { .. }
    ));
    assert_eq!(
        server
            .state
            .preview(
                PreviewRequest {
                    request_id: input.request_id,
                    target: target.clone(),
                    edge: 32
                },
                media_id
            )
            .unwrap_err()
            .code,
        ErrorCode::RequestConflict
    );
    let input = PreviewRequest {
        request_id: uuid::Uuid::now_v7().to_string(),
        target,
        edge: 32,
    };
    let a = server.state.preview(input.clone(), media_id).unwrap();
    assert_eq!(server.state.preview(input.clone(), media_id).unwrap(), a);
    assert!(matches!(
        terminal(&server.state, &a.task_id).await,
        ImportOutcome::MediaFailed { .. }
    ));
    server.state.close();
    assert_eq!(server.state.preview(input, media_id).unwrap(), a);
}

#[tokio::test(flavor = "multi_thread")]
async fn mixed_entity_view_keeps_corrupt_entry_and_valid_other_kind() {
    use diesel_async::RunQueryDsl;
    let (_root, server) = app().await;
    let domain = server.state.domain.clone();
    let entity = server
        .state
        .queue
        .submit("prepare mixed payloads", move |task| async move {
            let mut session = domain.database.session(&task).await.unwrap();
            let entity = domain.kernel.create_entity(&mut session).await.unwrap();
            for kind in [
                locus_media::api::MediaKind::Image,
                locus_media::api::MediaKind::Video,
            ] {
                let id = domain
                    .media
                    .create(&domain.kernel, &mut session, kind)
                    .await
                    .unwrap();
                domain
                    .kernel
                    .attach(
                        &mut session,
                        locus_core::api::Membership {
                            entity,
                            kind: kind.kind(),
                            component: id.component(),
                        },
                    )
                    .await
                    .unwrap();
            }
            session
                .transaction::<_, locus_store::api::StoreError, _>(|c| {
                    Box::pin(async move {
                        diesel::sql_query("UPDATE locus_images SET payload = 'invalid'")
                            .execute(c.connection())
                            .await?;
                        Ok(())
                    })
                })
                .await
                .unwrap();
            entity
        })
        .unwrap()
        .result()
        .await
        .unwrap();
    let memberships = server.state.memberships_batch(vec![entity]).await.unwrap();
    let EntityMemberships::Present { memberships, .. } = &memberships[0] else {
        panic!("present Entity was lost")
    };
    assert_eq!(memberships.len(), 2);
    // Damaged Image payload does not erase its known membership or prevent the
    // independent Video owner from returning its retained record.
    for membership in memberships {
        let component = locus_core::api::ComponentId::from_bytes(
            uuid::Uuid::parse_str(&membership.component_id)
                .unwrap()
                .as_bytes(),
        )
        .unwrap();
        if membership.kind_id == locus_media::api::MediaKind::Image.kind().to_string() {
            assert!(
                server
                    .state
                    .media_read(locus_media::api::MediaId::Image(
                        locus_media::api::ImageId::from_component(component)
                    ))
                    .await
                    .is_err()
            );
        } else {
            assert!(
                server
                    .state
                    .media_read(locus_media::api::MediaId::Video(
                        locus_media::api::VideoId::from_component(component)
                    ))
                    .await
                    .is_ok()
            );
        }
    }
    let entries = server.state.entity_media(entity).await.unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(
        entries
            .iter()
            .filter(|e| matches!(e.result, MediaEntryResult::Failed { .. }))
            .count(),
        1
    );
    assert_eq!(
        entries
            .iter()
            .filter(|e| matches!(e.result, MediaEntryResult::Readable { .. }))
            .count(),
        1
    );
}
