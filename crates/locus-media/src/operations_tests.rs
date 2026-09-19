use super::*;
use crate::{ImageOwner, MediaConfig, VideoOwner};
use locus_core::Membership;
use locus_file::{FILE_KIND, FileOwner};
use std::sync::Arc;

#[tokio::test(flavor = "multi_thread")]
async fn video_partial_success_replaces_old_fields_and_cancelled_apply_discards_session() {
    let directory = tempfile::tempdir().unwrap();
    let files = FileStorage::new(directory.path()).await.unwrap();
    let database = directory.path().join("metadata.sqlite");
    let mut session = Session::open(&database).await.unwrap();
    let media = MediaStorage::new(files.root(), MediaConfig::default()).unwrap();
    let mut kernel = Kernel::new();
    kernel.register(Arc::new(FileOwner)).unwrap();
    kernel.register(Arc::new(ImageOwner)).unwrap();
    kernel.register(Arc::new(VideoOwner)).unwrap();
    kernel.initialize(&mut session).await.unwrap();
    files.initialize(&mut session).await.unwrap();
    media.initialize(&mut session).await.unwrap();
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
        input: locus_file::CurrentInput::File(file.id),
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
                SelfStorage::apply_in(&participant, c, prepared).await?;
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
type SelfStorage = MediaStorage;
