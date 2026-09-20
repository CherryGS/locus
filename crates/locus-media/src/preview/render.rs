use super::types::{Preview, PreviewOrigin, Rendition};
use crate::{
    adapters::{image as image_adapter, video},
    error::{AttemptFailure, FailureCode, MediaError},
    facts::Facts,
    identity::{MediaId, MediaKind},
    service::MediaService,
};
use locus_core::api::Kernel;
use locus_file::api::{FileId, FileService};
use locus_store::api::Session;

impl MediaService {
    pub async fn preview(
        &self,
        kernel: &Kernel,
        files: &FileService,
        session: &mut Session,
        id: impl Into<MediaId>,
        rendition: Rendition,
    ) -> Result<Preview, MediaError> {
        if rendition.edge == 0
            || rendition.edge > 2048
            || rendition.edge > self.config.max_dimension
        {
            return Err(MediaError::Configuration(
                "rendition edge must be 1..=2048 and within dimension budget".into(),
            ));
        }
        let id = id.into();
        let kernel = kernel.clone();
        let (record, observed) = session
            .transaction_named("Media preview input", move |c| {
                Box::pin(async move {
                    let observed = Self::context_in(&kernel, c, id).await?;
                    if let Some(file) = observed.file() {
                        FileService::read_in(c, file).await?;
                    }
                    Ok::<_, MediaError>((Self::read_in(c, id).await?, observed))
                })
            })
            .await?;
        let file = observed.file().ok_or_else(|| {
            AttemptFailure::new(FailureCode::MissingInput, format!("{observed:?}"))
        })?;
        let hex = file.component().as_uuid().simple().to_string();
        let marker = format!("media-{hex}-video-v1-selection.json");
        let mut stream = None;
        if id.kind() == MediaKind::Video {
            stream = match &record.facts {
                Some(Facts::Video(facts)) if record.basis == Some(file) => Some(facts.stream_index),
                _ => None,
            };
            if stream.is_none() {
                let marker = marker.clone();
                stream = self
                    .cache_task(session.task_context(), move |storage| {
                        Ok(storage
                            .read_artifact(&marker, 32)?
                            .and_then(|bytes| serde_json::from_slice::<u32>(&bytes).ok()))
                    })
                    .await?;
            }
        }
        if id.kind() == MediaKind::Image || stream.is_some() {
            let name = name(file, id.kind(), rendition, stream);
            let hit = self
                .cache_task(session.task_context(), move |storage| {
                    if let Some(bytes) =
                        storage.read_artifact(&name, storage.config.max_output_bytes)?
                        && image_adapter::validate_png(&bytes, rendition.edge, &storage.config)
                            .is_ok()
                    {
                        return Ok(Some(storage.checked_artifact(&name)?));
                    }
                    Ok(None)
                })
                .await?;
            if let Some(path) = hit {
                return Ok(Preview {
                    file,
                    kind: id.kind(),
                    rendition,
                    stream_index: stream,
                    path,
                    origin: PreviewOrigin::Hit,
                });
            }
        }
        let bytes = match id.kind() {
            MediaKind::Image => {
                let input = files.local_path(session, file).await?;
                self.task_work(
                    session.task_context(),
                    "Image preview",
                    move |storage| async move {
                        Ok(image_adapter::thumbnail(&storage, input, rendition.edge).await?)
                    },
                )
                .await?
            }
            MediaKind::Video => {
                // Selection is re-established on misses, never borrowed from stale facts.
                let input = files.local_path(session, file).await?;
                let facts = self
                    .task_work(
                        session.task_context(),
                        "Video preview inspection",
                        move |storage| async move { Ok(video::inspect(&storage, input).await?) },
                    )
                    .await?;
                stream = Some(facts.stream_index);
                let input = files.local_path(session, file).await?;
                self.task_work(
                    session.task_context(),
                    "Video cover",
                    move |storage| async move {
                        Ok(video::cover(&storage, input, &facts, rendition.edge).await?)
                    },
                )
                .await?
            }
        };
        let path = self
            .cache_task(session.task_context(), move |storage| {
                let path = storage.publish(&name(file, id.kind(), rendition, stream), &bytes)?;
                if let Some(index) = stream {
                    storage.publish(&marker, index.to_string().as_bytes())?;
                }
                Ok(path)
            })
            .await?;
        Ok(Preview {
            file,
            kind: id.kind(),
            rendition,
            stream_index: stream,
            path,
            origin: PreviewOrigin::Generated,
        })
    }
}
pub(super) fn name(
    file: FileId,
    kind: MediaKind,
    rendition: Rendition,
    stream: Option<u32>,
) -> String {
    let hex = file.component().as_uuid().simple().to_string();
    match kind {
        MediaKind::Image => format!("media-{hex}-image-v1-{}.png", rendition.edge),
        MediaKind::Video => format!(
            "media-{hex}-video-v1-first-raster-{}-{}.png",
            stream.map_or_else(|| "none".into(), |v| v.to_string()),
            rendition.edge
        ),
    }
}
