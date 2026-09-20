use super::{registry::Shared, submissions::Arguments};
use crate::api::{dto::*, error::ApiError, media_dto::*, media_mapping as map};
use locus_core::api::{EntityId, Membership as CoreMembership};
use locus_media::api::{MediaId, Rendition};
use std::sync::Arc;

impl Shared {
    pub async fn create_entity(self: &Arc<Self>, id: String) -> Result<MutationOutcome, ApiError> {
        let domain = self.domain.clone();
        self.mutation(
            id,
            Arguments::CreateEntity,
            "Create entity",
            move |task| async move {
                let result = async {
                    let mut session = domain.database.session(&task).await.map_err(|e| {
                        DomainDiagnostic::Store {
                            diagnostic: map::store(&e),
                        }
                    })?;
                    domain
                        .kernel
                        .create_entity(&mut session)
                        .await
                        .map(|id| MutationOutcome::EntityCreated {
                            entity_id: id.to_string(),
                        })
                        .map_err(map::core)
                }
                .await;
                result.unwrap_or_else(|diagnostic| MutationOutcome::Failed { diagnostic })
            },
        )
        .await
    }
    pub async fn create_media(
        self: &Arc<Self>,
        request: CreateMedia,
    ) -> Result<MutationOutcome, ApiError> {
        let domain = self.domain.clone();
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
                            diagnostic: map::store(&e),
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
    pub async fn membership(
        self: &Arc<Self>,
        request: ChangeMembership,
        membership: CoreMembership,
        attach: bool,
    ) -> Result<MutationOutcome, ApiError> {
        let domain = self.domain.clone();
        let arguments = if attach {
            Arguments::Attach(request.membership)
        } else {
            Arguments::Detach(request.membership)
        };
        self.mutation(
            request.request_id,
            arguments,
            if attach {
                "Attach component"
            } else {
                "Detach component"
            },
            move |task| async move {
                let result = async {
                    let mut session = domain.database.session(&task).await.map_err(|e| {
                        DomainDiagnostic::Store {
                            diagnostic: map::store(&e),
                        }
                    })?;
                    if attach {
                        domain
                            .kernel
                            .attach(&mut session, membership)
                            .await
                            .map(|o| match o {
                                locus_core::api::AttachOutcome::Attached => {
                                    MutationOutcome::Attached
                                }
                                locus_core::api::AttachOutcome::AlreadyAttached => {
                                    MutationOutcome::AlreadyAttached
                                }
                            })
                            .map_err(map::core)
                    } else {
                        domain
                            .kernel
                            .detach(&mut session, membership)
                            .await
                            .map(|removed| MutationOutcome::Detached { removed })
                            .map_err(map::core)
                    }
                }
                .await;
                result.unwrap_or_else(|diagnostic| MutationOutcome::Failed { diagnostic })
            },
        )
        .await
    }
    pub async fn memberships(
        self: &Arc<Self>,
        entity: EntityId,
    ) -> Result<Vec<Membership>, ApiError> {
        let domain = self.domain.clone();
        self.query("Read memberships", move |task| async move {
            let mut session = domain.database.session(&task).await.map_err(|e| {
                ApiError::domain(DomainDiagnostic::Store {
                    diagnostic: map::store(&e),
                })
            })?;
            domain
                .kernel
                .memberships(&mut session, entity)
                .await
                .map(|v| v.into_iter().map(map::membership).collect())
                .map_err(|e| ApiError::domain(map::core(e)))
        })
        .await
    }
    pub async fn media_read(self: &Arc<Self>, id: MediaId) -> Result<MediaRecord, ApiError> {
        let domain = self.domain.clone();
        self.query("Read Media", move |task| async move {
            let mut session = domain.database.session(&task).await.map_err(|e| {
                ApiError::domain(DomainDiagnostic::Store {
                    diagnostic: map::store(&e),
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
        let domain = self.domain.clone();
        self.query("View Media", move |task| async move {
            let mut session = domain.database.session(&task).await.map_err(|e| {
                ApiError::domain(DomainDiagnostic::Store {
                    diagnostic: map::store(&e),
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
        let domain = self.domain.clone();
        self.query("View entity Media", move |task| async move {
            let mut session = domain.database.session(&task).await.map_err(|e| {
                ApiError::domain(DomainDiagnostic::Store {
                    diagnostic: map::store(&e),
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
        let domain = self.domain.clone();
        self.public(
            request.request_id,
            Arguments::Interpret(request.target),
            "Interpret Media",
            move |task| async move {
                let result = async {
                    let mut session = domain.database.session(&task).await.map_err(|e| {
                        DomainDiagnostic::Store {
                            diagnostic: map::store(&e),
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
        let domain = self.domain.clone();
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
                            diagnostic: map::store(&e),
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
}
