use crate::{
    adapters::{image, video},
    error::{AttemptFailure, FailureCode, MediaError},
    service::MediaService,
};
use locus_file::api::{FileId, FileService};
use locus_store::api::Session;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Recognition {
    Match,
    NoMatch,
    Failed(AttemptFailure),
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileRecognition {
    pub file: FileId,
    pub image: Recognition,
    pub video: Recognition,
}
fn observation(result: Result<(), AttemptFailure>) -> Recognition {
    match result {
        Ok(()) => Recognition::Match,
        Err(e) if e.code == FailureCode::UnsupportedInput => Recognition::NoMatch,
        Err(e) => Recognition::Failed(e),
    }
}
impl MediaService {
    /// Read-only recognition before any Media component exists. Shared File access
    /// failures return separately; an adapter failure never hides the other kind.
    pub async fn recognize(
        &self,
        files: &FileService,
        session: &mut Session,
        file: FileId,
    ) -> Result<FileRecognition, MediaError> {
        let image_input = files.local_path(session, file).await?;
        let video_input = files.local_path(session, file).await?;
        self.task_work(
            session.task_context(),
            "Media recognition",
            move |storage| async move {
                let image = observation(image::recognize(&storage, image_input).await);
                let video = observation(video::inspect(&storage, video_input).await.map(|_| ()));
                Ok(FileRecognition { file, image, video })
            },
        )
        .await
    }
}
