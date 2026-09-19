use crate::{
    error::MediaError,
    identity::{MediaId, MediaKind},
    input::InputContext,
    record::MediaRecord,
    service::MediaService,
};
use locus_core::api::{EntityId, Kernel, Membership};
use locus_file::api::{CurrentInput, FileService, InputComparison, compare_input};
use locus_store::api::{Context, Session};

#[derive(Debug)]
pub enum Applicability {
    Unmounted,
    Input(InputComparison),
    /// Membership and File record read errors retain the Media record.
    Error(MediaError),
}
#[derive(Debug)]
pub struct MediaView {
    pub record: MediaRecord,
    pub applicability: Applicability,
}
#[derive(Debug)]
pub struct MediaEntry {
    pub membership: Membership,
    pub result: Result<MediaView, MediaError>,
}

impl MediaService {
    pub async fn view(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        id: impl Into<MediaId>,
    ) -> Result<MediaView, MediaError> {
        let id = id.into();
        let kernel = kernel.clone();
        session
            .transaction(move |c| Box::pin(async move { Self::view_in(&kernel, c, id).await }))
            .await
    }
    pub async fn view_in(
        kernel: &Kernel,
        context: &mut Context,
        id: MediaId,
    ) -> Result<MediaView, MediaError> {
        let record = Self::read_in(context, id).await?;
        let applicability = match Self::context_in(kernel, context, id).await {
            Ok(InputContext::Unmounted) => Applicability::Unmounted,
            Ok(InputContext::Hosted { input, .. }) => {
                let check = async {
                    if let CurrentInput::File(file) = input {
                        FileService::read_in(context, file).await?;
                    }
                    Ok::<_, MediaError>(compare_input(record.basis, Ok(input))?)
                }
                .await;
                match check {
                    Ok(comparison) => Applicability::Input(comparison),
                    Err(e) => Applicability::Error(e),
                }
            }
            Err(error) => Applicability::Error(error),
        };
        Ok(MediaView {
            record,
            applicability,
        })
    }
    pub async fn entity_view(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        entity: EntityId,
    ) -> Result<Vec<MediaEntry>, MediaError> {
        let kernel = kernel.clone();
        session
            .transaction(move |c| {
                Box::pin(async move {
                    let memberships = kernel.memberships_in(c, entity).await?;
                    let mut entries = Vec::new();
                    for membership in memberships {
                        let kind = if membership.kind == crate::identity::IMAGE_KIND {
                            MediaKind::Image
                        } else if membership.kind == crate::identity::VIDEO_KIND {
                            MediaKind::Video
                        } else {
                            continue;
                        };
                        entries.push(MediaEntry {
                            membership,
                            result: Self::view_in(&kernel, c, kind.id(membership.component)).await,
                        });
                    }
                    Ok(entries)
                })
            })
            .await
    }
}
