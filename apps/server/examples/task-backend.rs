//! Isolated real backend consumer of the shared task foundation.
use anyhow::Context;
use locus_core::api::{Kernel, Membership};
use locus_file::api::{FILE_KIND, FileOwner, FileRecord, FileService};
use locus_media::api::{
    ApplyOutcome, ImageOwner, MediaConfig, MediaKind, MediaService, Preview, Rendition, VideoOwner,
};
use locus_store::api::TaskDatabase;
use locus_task::api::{TaskHandle, TaskQueue, TaskState};
use locus_twitter::api::{TwitterId, TwitterOwner, TwitterService, TwitterSnapshot};
use std::sync::Arc;

#[derive(Debug)]
struct Imported {
    file: FileRecord,
    interpretation: ApplyOutcome,
    preview: Preview,
    twitter: TwitterId,
}

async fn observe<T>(handle: TaskHandle<T>) -> Result<T, locus_task::api::TaskError> {
    let mut changes = handle.subscribe();
    let observer = tokio::spawn(async move {
        loop {
            let snapshot = changes.borrow_and_update().clone();
            println!(
                "{}: {:?} {:?} {:?}/{:?} {:?}",
                snapshot.label,
                snapshot.state,
                snapshot.stage,
                snapshot.completed,
                snapshot.total,
                snapshot.message
            );
            if matches!(snapshot.state, TaskState::Completed | TaskState::Failed) {
                break;
            }
            if changes.changed().await.is_err() {
                break;
            }
        }
    });
    let result = handle.result().await;
    let _ = observer.await;
    result
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let root = tempfile::tempdir().context("isolated task backend root")?;
    for result in demonstrate(root.path()).await? {
        println!(
            "Retained File {:?}; Twitter {:?}; interpretation {:?}; preview {:?}",
            result.file.id, result.twitter, result.interpretation, result.preview
        );
    }
    Ok(())
}

async fn demonstrate(root: &std::path::Path) -> anyhow::Result<Vec<Imported>> {
    let source = root.join("synthetic.png");
    image::RgbaImage::from_pixel(1024, 768, image::Rgba([27, 93, 181, 255])).save(&source)?;
    let files = FileService::new(root.join("library")).await?;
    let media = MediaService::new(files.root(), MediaConfig::default())?;
    let mut kernel = Kernel::new();
    kernel.register(Arc::new(FileOwner))?;
    kernel.register(Arc::new(ImageOwner))?;
    kernel.register(Arc::new(VideoOwner))?;
    kernel.register(Arc::new(TwitterOwner))?;
    let queue = TaskQueue::new();
    let database = TaskDatabase::open(&queue, files.root().join("metadata.sqlite")).await?;
    let init_db = database.clone();
    observe(queue.submit("Initialize", move |task| async move {
        let mut session = init_db.session(&task).await?;
        locus_migration::api::migrate(&mut session).await?;
        Ok::<_, anyhow::Error>(())
    })?)
    .await??;

    let mut observers = Vec::new();
    for index in 1..=2 {
        let (database, kernel, files, media, source) = (
            database.clone(),
            kernel.clone(),
            files.clone(),
            media.clone(),
            source.clone(),
        );
        let handle = queue.submit(format!("Import {index}"), move |task| async move {
            let mut session = database.session(&task).await?;
            let file = files.admit(&kernel, &mut session, source).await?;
            // Actual shared-transaction participants reuse this one DB stage.
            let participants = kernel.clone();
            let file_id = file.id;
            let (id, snapshot) = session
                .transaction::<_, anyhow::Error, _>(move |context| {
                    Box::pin(async move {
                        let entity = participants.create_entity_in(context).await?;
                        participants
                            .attach_in(
                                context,
                                Membership {
                                    entity,
                                    kind: FILE_KIND,
                                    component: file_id.component(),
                                },
                            )
                            .await?;
                        let id = MediaService::create_in(&participants, context, MediaKind::Image)
                            .await?;
                        participants
                            .attach_in(
                                context,
                                Membership {
                                    entity,
                                    kind: MediaKind::Image.kind(),
                                    component: id.component(),
                                },
                            )
                            .await?;
                        let snapshot = TwitterService::create_in(
                            &participants,
                            context,
                            TwitterSnapshot {
                                post_id: Some(format!("12345{index}")),
                                ..Default::default()
                            },
                        )
                        .await?;
                        Ok((id, snapshot))
                    })
                })
                .await?;
            let interpretation = media.interpret(&kernel, &files, &mut session, id).await?;
            let preview = media
                .preview(&kernel, &files, &mut session, id, Rendition { edge: 160 })
                .await?;
            Ok::<_, anyhow::Error>(Imported {
                file,
                interpretation,
                preview,
                twitter: snapshot,
            })
        })?;
        observers.push(tokio::spawn(observe(handle)));
    }
    let mut results = Vec::new();
    for observer in observers {
        results.push(observer.await???);
    }
    Ok(results)
}

#[cfg(test)]
#[path = "task_backend/tests.rs"]
mod tests;
