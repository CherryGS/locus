use crate::{
    error::MediaError,
    identity::{ImageId, MediaId, MediaKind, VideoId},
    persistence,
    record::MediaRecord,
    service::MediaService,
};
use locus_core::api::{ComponentId, Kernel};
use locus_store::api::{Context, Session};

impl MediaService {
    pub async fn create_image(
        &self,
        kernel: &Kernel,
        session: &mut Session,
    ) -> Result<ImageId, MediaError> {
        match self.create(kernel, session, MediaKind::Image).await? {
            MediaId::Image(id) => Ok(id),
            _ => Err(MediaError::Corrupt("creation kind".into())),
        }
    }
    pub async fn create_video(
        &self,
        kernel: &Kernel,
        session: &mut Session,
    ) -> Result<VideoId, MediaError> {
        match self.create(kernel, session, MediaKind::Video).await? {
            MediaId::Video(id) => Ok(id),
            _ => Err(MediaError::Corrupt("creation kind".into())),
        }
    }
    pub async fn create(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        kind: MediaKind,
    ) -> Result<MediaId, MediaError> {
        let kernel = kernel.clone();
        session
            .transaction(move |c| Box::pin(async move { Self::create_in(&kernel, c, kind).await }))
            .await
    }
    pub async fn create_in(
        kernel: &Kernel,
        context: &mut Context,
        kind: MediaKind,
    ) -> Result<MediaId, MediaError> {
        let kernel = kernel.clone();
        context
            .savepoint(move |c| {
                Box::pin(async move {
                    let id = kind.id(ComponentId::new());
                    let record = MediaRecord {
                        id,
                        revision: 0,
                        basis: None,
                        facts: None,
                        last_failure: None,
                    };
                    persistence::insert(c, &record).await?;
                    kernel
                        .admit_component_in(c, kind.kind(), id.component())
                        .await?;
                    Ok(id)
                })
            })
            .await
    }
}
