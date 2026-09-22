use super::{
    bytes::{OpenedBytes, opened},
    registry::Shared,
    submissions::Arguments,
};
use crate::api::{
    dto::*,
    error::{ApiError, DomainDiagnostic, ErrorCode},
    media::{dto::*, mapping as map},
    store,
};
use locus_core::api::EntityId;
use locus_media::api::{MediaId, Rendition};
use std::sync::Arc;
impl Shared {
    pub async fn create_media(
        self: &Arc<Self>,
        request: CreateMedia,
    ) -> Result<MutationOutcome, ApiError> {
        let domain = self.business()?.clone();
        let kind = match request.kind {
            MediaKind::Image => locus_media::api::MediaKind::Image,
            MediaKind::Video => locus_media::api::MediaKind::Video,
        };
        self.mutation(
            request.request_id,
            Arguments::CreateMedia(request.kind),
            "Create Media",
            move |task| async move {
                let result = async {
                    let mut session = domain.database.session(&task).await.map_err(|e| {
                        DomainDiagnostic::Store {
                            diagnostic: store::diagnostic(&e),
                        }
                    })?;
                    domain
                        .media
                        .create(&domain.kernel, &mut session, kind)
                        .await
                        .map(|id| MutationOutcome::MediaCreated {
                            target: map::target(id),
                            kind_id: kind.kind().to_string(),
                        })
                        .map_err(map::media)
                }
                .await;
                result.unwrap_or_else(|diagnostic| MutationOutcome::Failed { diagnostic })
            },
        )
        .await
    }
    pub async fn media_read(self: &Arc<Self>, id: MediaId) -> Result<MediaRecord, ApiError> {
        let domain = self.business()?.clone();
        self.query("Read Media", move |task| async move {
            let mut session = domain.database.session(&task).await.map_err(|e| {
                ApiError::domain(DomainDiagnostic::Store {
                    diagnostic: store::diagnostic(&e),
                })
            })?;
            domain
                .media
                .read(&mut session, id)
                .await
                .map(map::record)
                .map_err(|e| ApiError::domain(map::media(e)))
        })
        .await
    }
    pub async fn media_view(self: &Arc<Self>, id: MediaId) -> Result<MediaView, ApiError> {
        let domain = self.business()?.clone();
        self.query("View Media", move |task| async move {
            let mut session = domain.database.session(&task).await.map_err(|e| {
                ApiError::domain(DomainDiagnostic::Store {
                    diagnostic: store::diagnostic(&e),
                })
            })?;
            domain
                .media
                .view(&domain.kernel, &mut session, id)
                .await
                .map(map::view)
                .map_err(|e| ApiError::domain(map::media(e)))
        })
        .await
    }
    pub async fn entity_media(
        self: &Arc<Self>,
        entity: EntityId,
    ) -> Result<Vec<MediaEntry>, ApiError> {
        let domain = self.business()?.clone();
        self.query("View entity Media", move |task| async move {
            let mut session = domain.database.session(&task).await.map_err(|e| {
                ApiError::domain(DomainDiagnostic::Store {
                    diagnostic: store::diagnostic(&e),
                })
            })?;
            domain
                .media
                .entity_view(&domain.kernel, &mut session, entity)
                .await
                .map(|v| v.into_iter().map(map::entry).collect())
                .map_err(|e| ApiError::domain(map::media(e)))
        })
        .await
    }
    pub fn interpret(
        self: &Arc<Self>,
        request: InterpretRequest,
        id: MediaId,
    ) -> Result<Receipt, ApiError> {
        let domain = self.business()?.clone();
        self.public(
            request.request_id,
            Arguments::Interpret(request.target),
            "Interpret Media",
            move |task| async move {
                let result = async {
                    let mut session = domain.database.session(&task).await.map_err(|e| {
                        DomainDiagnostic::Store {
                            diagnostic: store::diagnostic(&e),
                        }
                    })?;
                    domain
                        .media
                        .interpret(&domain.kernel, &domain.files, &mut session, id)
                        .await
                        .map(|o| match o {
                            locus_media::api::ApplyOutcome::Accepted(r) => {
                                Interpretation::Accepted {
                                    record: map::record(r),
                                }
                            }
                            locus_media::api::ApplyOutcome::RejectedContextChanged => {
                                Interpretation::RejectedContextChanged
                            }
                            locus_media::api::ApplyOutcome::RejectedNewerAttempt => {
                                Interpretation::RejectedNewerAttempt
                            }
                        })
                        .map_err(map::media)
                }
                .await;
                match result {
                    Ok(result) => TaskOutcome::Interpreted { result },
                    Err(diagnostic) => TaskOutcome::MediaFailed { diagnostic },
                }
            },
        )
    }
    pub fn preview(
        self: &Arc<Self>,
        request: PreviewRequest,
        id: MediaId,
    ) -> Result<Receipt, ApiError> {
        let state = self.clone();
        let domain = self.business()?.clone();
        self.public(
            request.request_id,
            Arguments::Preview {
                target: request.target,
                edge: request.edge,
            },
            "Generate Media preview",
            move |task| async move {
                let result = async {
                    let mut session = domain.database.session(&task).await.map_err(|e| {
                        DomainDiagnostic::Store {
                            diagnostic: store::diagnostic(&e),
                        }
                    })?;
                    domain
                        .media
                        .preview(
                            &domain.kernel,
                            &domain.files,
                            &mut session,
                            id,
                            Rendition { edge: request.edge },
                        )
                        .await
                        .map_err(map::media)
                }
                .await;
                match result {
                    Err(diagnostic) => TaskOutcome::MediaFailed { diagnostic },
                    Ok(preview) => {
                        let locator = uuid::Uuid::now_v7().to_string();
                        let output = PreviewMetadata {
                            locator: locator.clone(),
                            file_id: preview.file.to_string(),
                            kind: map::kind(preview.kind),
                            edge: preview.rendition.edge,
                            stream_index: preview.stream_index,
                            origin: match preview.origin {
                                locus_media::api::PreviewOrigin::Hit => PreviewOrigin::Hit,
                                locus_media::api::PreviewOrigin::Generated => {
                                    PreviewOrigin::Generated
                                }
                            },
                        };
                        state.lock().previews.insert(locator, Arc::new(preview));
                        TaskOutcome::Preview { preview: output }
                    }
                }
            },
        )
    }
    pub async fn derived(self: &Arc<Self>, locator: String) -> Result<OpenedBytes, ApiError> {
        let preview = self
            .lock()
            .previews
            .get(&locator)
            .cloned()
            .or_else(|| {
                self.imports
                    .snapshots()
                    .into_iter()
                    .flat_map(|b| b.items)
                    .flat_map(|i| i.current.kinds)
                    .find(|k| k.locator.as_deref() == Some(&locator))
                    .and_then(|k| k.output)
            })
            .ok_or_else(|| {
                ApiError::new(
                    ErrorCode::PreviewUnavailable,
                    "Unknown preview locator in this run",
                )
            })?;
        let media = self.business()?.media.clone();
        self.query("Open derived bytes",move |task|async move {
            let file=media.open_preview(&task,&preview).await.map_err(|e| {
                let code=if matches!(&e,locus_media::api::MediaError::PreviewAccess(e) if e.kind()==std::io::ErrorKind::PermissionDenied) { ErrorCode::AccessDenied } else { ErrorCode::OperationFailed };
                let mut error=ApiError::domain(map::media(e)); error.code=code; error
            })?.ok_or_else(||ApiError::new(ErrorCode::PreviewUnavailable,"Preview bytes are no longer available; generation is explicit"))?;
            opened(&task,move ||Ok(file)).await
        }).await
    }
}
