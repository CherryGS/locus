use super::attempt::PreparedInterpretation;
use crate::{
    adapters::video,
    config::MediaConfig,
    error::{AttemptFailure, FailureCode, MediaError},
    facts::Facts,
    identity::MediaKind,
    input::InputContext,
    owner::{ImageOwner, VideoOwner},
    service::MediaService,
};
use locus_core::api::Kernel;
use locus_core::api::Membership;
use locus_file::api::FileService;
use locus_file::api::{FILE_KIND, FileOwner};
use locus_store::api::Session;
use std::sync::Arc;

#[tokio::test(flavor = "multi_thread")]
async fn video_partial_success_replaces_old_fields_and_cancelled_apply_discards_session() {
    let directory = tempfile::tempdir().unwrap();
    let files = FileService::new(directory.path()).await.unwrap();
    let database = directory.path().join("metadata.sqlite");
    let mut session = Session::open(&database).await.unwrap();
    let media = MediaService::new(files.root(), MediaConfig::default()).unwrap();
    let mut kernel = Kernel::new();
    kernel.register(Arc::new(FileOwner)).unwrap();
    kernel.register(Arc::new(ImageOwner)).unwrap();
    kernel.register(Arc::new(VideoOwner)).unwrap();
    locus_migration::api::migrate(&mut session).await.unwrap();
    let path = directory.path().join("input.mp4");
    std::fs::write(&path, b"\0\0\0\x14ftypisom\0\0\0\0mp42").unwrap();
    let entity = kernel.create_entity(&mut session).await.unwrap();
    let file = files.admit(&kernel, &mut session, &path).await.unwrap();
    kernel
        .attach(
            &mut session,
            Membership {
                entity,
                kind: FILE_KIND,
                component: file.id.component(),
            },
        )
        .await
        .unwrap();
    let id = media
        .create(&kernel, &mut session, MediaKind::Video)
        .await
        .unwrap();
    kernel
        .attach(
            &mut session,
            Membership {
                entity,
                kind: id.kind().kind(),
                component: id.component(),
            },
        )
        .await
        .unwrap();
    // Private seam consumes the same parser outputs as preparation; callers cannot
    // manufacture these tokens or assign observed inputs in the public API.
    let observed = InputContext::Hosted {
        host: entity,
        input: locus_file::api::CurrentInput::File(file.id),
    };
    let full=video::parse(br#"{"streams":[{"index":0,"codec_type":"video","codec_name":"h264","width":640,"height":360,"duration":"20"}]}"#,video::Family::Mov).unwrap();
    media
        .apply(
            &kernel,
            &mut session,
            PreparedInterpretation {
                id,
                revision: 0,
                observed,
                result: Ok(Facts::Video(full)),
            },
        )
        .await
        .unwrap();
    let partial = video::parse(
        br#"{"streams":[{"index":0,"codec_type":"video"}]}"#,
        video::Family::Mov,
    )
    .unwrap();
    media
        .apply(
            &kernel,
            &mut session,
            PreparedInterpretation {
                id,
                revision: 1,
                observed,
                result: Ok(Facts::Video(partial.clone())),
            },
        )
        .await
        .unwrap();
    let record = media.read(&mut session, id).await.unwrap();
    assert_eq!(record.facts, Some(Facts::Video(partial)));
    let prepared = PreparedInterpretation {
        id,
        revision: 2,
        observed,
        result: Err(AttemptFailure::new(
            FailureCode::Decode,
            "failed after partial success",
        )),
    };
    let participant = kernel.clone();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    {
        let operation = session.transaction::<(), MediaError, _>(move |c| {
            Box::pin(async move {
                MediaService::apply_in(&participant, c, prepared).await?;
                let _ = sender.send(());
                std::future::pending::<()>().await;
                Ok(())
            })
        });
        tokio::pin!(operation);
        tokio::select! { _=receiver => (), result=&mut operation => panic!("unexpected completion {result:?}") }
    }
    assert!(!session.is_usable());
    let mut reopened = Session::open(&database).await.unwrap();
    assert_eq!(media.read(&mut reopened, id).await.unwrap(), record);
}

#[tokio::test(flavor = "multi_thread")]
async fn task_interpretation_releases_database_and_rejects_intervening_context_and_revision() {
    use super::attempt::ApplyOutcome;
    use locus_store::api::TaskDatabase;
    use locus_task::api::{TaskQueue, TaskState};
    tokio::time::timeout(std::time::Duration::from_secs(15), async {
        let directory = tempfile::tempdir().unwrap();
        let files = FileService::new(directory.path()).await.unwrap();
        let media = MediaService::new(files.root(), MediaConfig { max_parallel: 1, ..Default::default() }).unwrap();
        let mut kernel = Kernel::new();
        kernel.register(Arc::new(FileOwner)).unwrap(); kernel.register(Arc::new(ImageOwner)).unwrap();
        let queue = TaskQueue::new();
        let database = TaskDatabase::open(&queue, directory.path().join("metadata.sqlite")).await.unwrap();
        let input = directory.path().join("synthetic.png");
        image::RgbaImage::from_pixel(20, 30, image::Rgba([10, 30, 50, 255])).save(&input).unwrap();
        let (db, k, f, m) = (database.clone(), kernel.clone(), files.clone(), media.clone());
        let (entity, id, membership) = queue.submit("setup", move |task| async move {
            let mut session = db.session(&task).await.unwrap();
            locus_migration::api::migrate(&mut session).await.unwrap();
            let file = f.admit(&k, &mut session, input).await.unwrap();
            let entity = k.create_entity(&mut session).await.unwrap();
            let membership = Membership { entity, kind: FILE_KIND, component: file.id.component() };
            k.attach(&mut session, membership).await.unwrap();
            let id = m.create(&k, &mut session, MediaKind::Image).await.unwrap();
            k.attach(&mut session, Membership { entity, kind: id.kind().kind(), component: id.component() }).await.unwrap();
            (entity, id, membership)
        }).unwrap().result().await.unwrap();

        // Hold the real decoder admission permit. Preparation has already observed
        // File/revision when it reaches its inspection stage, outside a transaction.
        let permit = media.workers.clone().acquire_owned().await.unwrap();
        let (db, k, f, m) = (database.clone(), kernel.clone(), files.clone(), media.clone());
        let interpretation = queue.submit("interpret", move |task| async move {
            let mut session = db.session(&task).await.unwrap();
            m.interpret(&k, &f, &mut session, id).await.unwrap()
        }).unwrap();
        let mut changes = interpretation.subscribe();
        loop {
            let snapshot = changes.borrow_and_update().clone();
            if snapshot.state == TaskState::Running && snapshot.stage.as_deref() == Some("Media inspection") { break; }
            changes.changed().await.unwrap();
        }
        let (db, k) = (database.clone(), kernel.clone());
        queue.submit("change File during inspection", move |task| async move {
            let mut session = db.session(&task).await.unwrap();
            assert!(k.entity_exists(&mut session, entity).await.unwrap());
            k.detach(&mut session, membership).await.unwrap();
        }).unwrap().result().await.unwrap();
        assert_eq!(interpretation.snapshot().state, TaskState::Running);
        drop(permit);
        assert!(matches!(interpretation.result().await.unwrap(), ApplyOutcome::RejectedContextChanged));

        let (db, k, f, m) = (database.clone(), kernel.clone(), files.clone(), media.clone());
        let (prepared, newer) = queue.submit("prepare two revisions", move |task| async move {
            let mut session = db.session(&task).await.unwrap();
            k.attach(&mut session, membership).await.unwrap();
            (m.prepare(&k, &f, &mut session, id).await.unwrap(), m.prepare(&k, &f, &mut session, id).await.unwrap())
        }).unwrap().result().await.unwrap();
        let (db, k, m, f) = (database.clone(), kernel.clone(), media.clone(), files.clone());
        queue.submit("apply newer then stale", move |task| async move {
            let mut session = db.session(&task).await.unwrap();
            assert!(matches!(m.apply(&k, &mut session, newer).await.unwrap(), ApplyOutcome::Accepted(record) if record.last_failure.is_none() && record.facts.is_some()));
            assert!(matches!(m.apply(&k, &mut session, prepared).await.unwrap(), ApplyOutcome::RejectedNewerAttempt));
            k.detach(&mut session, membership).await.unwrap();
            let warning = m.interpret(&k, &f, &mut session, id).await.unwrap();
            assert!(matches!(warning, ApplyOutcome::Accepted(record) if record.last_failure.is_some() && record.facts.is_some()));
        }).unwrap().result().await.unwrap();
    }).await.unwrap();
}
