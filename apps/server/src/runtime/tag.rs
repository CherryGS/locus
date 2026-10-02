use super::{Shared, submissions::Arguments};
use crate::api::{
    dto::MutationOutcome,
    error::{ApiError, ErrorCode},
    tag::dto::*,
};
use locus_core::api::{ComponentId, EntityId};
use locus_tag::api::{TagError, TagId, TagService};
use std::sync::Arc;
fn failure(e: TagError) -> ApiError {
    let code = match e {
        TagError::MissingTag
        | TagError::MissingSet
        | TagError::Core(locus_core::api::CoreError::MissingEntity(_)) => ErrorCode::NotFound,
        _ => ErrorCode::OperationFailed,
    };
    ApiError::new(code, e.to_string())
}
fn tag(id: &str) -> Result<TagId, TagError> {
    TagId::from_bytes(
        uuid::Uuid::parse_str(id)
            .map_err(|e| TagError::Corrupt(e.to_string()))?
            .as_bytes(),
    )
    .map_err(Into::into)
}
fn entity(id: &str) -> Result<EntityId, TagError> {
    EntityId::from_bytes(
        uuid::Uuid::parse_str(id)
            .map_err(|e| TagError::Corrupt(e.to_string()))?
            .as_bytes(),
    )
    .map_err(Into::into)
}
impl Shared {
    pub async fn tags(self: &Arc<Self>) -> Result<Vec<TagRecord>, ApiError> {
        let db = self.business()?.database.clone();
        self.query("List Tags", move |task| async move {
            let mut s = db.session(&task).await.map_err(|e| failure(e.into()))?;
            s.transaction(|c| Box::pin(async move { TagService::list_in(c).await }))
                .await
                .map(|v| v.into_iter().map(Into::into).collect())
                .map_err(failure)
        })
        .await
    }
    pub async fn tag_read(self: &Arc<Self>, id: TagId) -> Result<TagRecord, ApiError> {
        let db = self.business()?.database.clone();
        self.query("Read Tag", move |task| async move {
            let mut s = db.session(&task).await.map_err(|e| failure(e.into()))?;
            s.transaction(move |c| Box::pin(async move { TagService::read_in(c, id).await }))
                .await
                .map(Into::into)
                .map_err(failure)
        })
        .await
    }
    pub async fn tag_set(self: &Arc<Self>, id: ComponentId) -> Result<TagSetRecord, ApiError> {
        let db = self.business()?.database.clone();
        self.query("Read Tag set", move |task| async move {
            let mut s = db.session(&task).await.map_err(|e| failure(e.into()))?;
            s.transaction(move |c| Box::pin(async move { TagService::read_set_in(c, id).await }))
                .await
                .map(Into::into)
                .map_err(failure)
        })
        .await
    }
    pub async fn tag_document(self: &Arc<Self>, id: TagId) -> Result<TagDocument, ApiError> {
        let db = self.business()?.database.clone();
        self.query("Read Tag document", move |task| async move {
            let mut s = db.session(&task).await.map_err(|e| failure(e.into()))?;
            s.transaction(move |c| {
                Box::pin(async move { TagService::read_document_in(c, id).await })
            })
            .await
            .map(Into::into)
            .map_err(failure)
        })
        .await
    }
    pub async fn entity_tags(self: &Arc<Self>, id: EntityId) -> Result<EntityTags, ApiError> {
        let d = self.business()?.clone();
        self.query("Read Entity Tags", move |task| async move {
            let mut s = d
                .database
                .session(&task)
                .await
                .map_err(|e| failure(e.into()))?;
            s.transaction(move |c| {
                Box::pin(async move { TagService::entity_in(&d.kernel, c, id).await })
            })
            .await
            .map(|set| EntityTags {
                entity_id: id.to_string(),
                tag_set: set.map(Into::into),
            })
            .map_err(failure)
        })
        .await
    }
    pub async fn tag_write(
        self: &Arc<Self>,
        request: String,
        change: TagChange,
    ) -> Result<MutationOutcome, ApiError> {
        let d = self.business()?.clone();
        self.mutation(
            request,
            Arguments::Tag(change.clone()),
            "Edit personal Tags",
            move |task| async move {
                let result = async {
                    let mut s = d.database.session(&task).await?;
                    s.transaction(move |c| {
                        Box::pin(async move {
                            Ok::<_, TagError>(match change {
                                TagChange::Create { name, parent } => MutationOutcome::TagSaved {
                                    tag: TagService::create_under_in(
                                        c,
                                        &name,
                                        parent.as_deref().map(tag).transpose()?,
                                    )
                                    .await?
                                    .into(),
                                },
                                TagChange::Rename { id, revision, name } => {
                                    MutationOutcome::TagSaved {
                                        tag: TagService::rename_in(c, tag(&id)?, &revision, &name)
                                            .await?
                                            .into(),
                                    }
                                }
                                TagChange::Move {
                                    id,
                                    revision,
                                    parent,
                                } => MutationOutcome::TagSaved {
                                    tag: TagService::move_in(
                                        c,
                                        tag(&id)?,
                                        &revision,
                                        parent.as_deref().map(tag).transpose()?,
                                    )
                                    .await?
                                    .into(),
                                },
                                TagChange::Delete { id, revision } => {
                                    TagService::delete_in(c, tag(&id)?, &revision).await?;
                                    MutationOutcome::TagDeleted { id }
                                }
                                TagChange::Markdown {
                                    id,
                                    revision,
                                    markdown,
                                } => MutationOutcome::TagSaved {
                                    tag: TagService::save_markdown_in(
                                        c,
                                        tag(&id)?,
                                        &revision,
                                        &markdown,
                                    )
                                    .await?
                                    .into(),
                                },
                                TagChange::Add { entity_id, tag_id } => {
                                    let changed = TagService::add_in(
                                        &d.kernel,
                                        c,
                                        entity(&entity_id)?,
                                        tag(&tag_id)?,
                                    )
                                    .await?;
                                    MutationOutcome::TagAssignment {
                                        entity_id,
                                        tag_id,
                                        changed,
                                    }
                                }
                                TagChange::Remove { entity_id, tag_id } => {
                                    let changed = TagService::remove_in(
                                        &d.kernel,
                                        c,
                                        entity(&entity_id)?,
                                        tag(&tag_id)?,
                                    )
                                    .await?;
                                    MutationOutcome::TagAssignment {
                                        entity_id,
                                        tag_id,
                                        changed,
                                    }
                                }
                            })
                        })
                    })
                    .await
                }
                .await;
                result.unwrap_or_else(|e: TagError| MutationOutcome::TagFailed {
                    reason: match &e {
                        TagError::BlankName => "blank_name",
                        TagError::DuplicateName => "duplicate_name",
                        TagError::Conflict => "conflict",
                        TagError::InvalidParent => "invalid_parent",
                        TagError::MissingTag => "missing_tag",
                        TagError::Core(locus_core::api::CoreError::MissingEntity(_)) => {
                            "missing_entity"
                        }
                        _ => "storage",
                    }
                    .into(),
                    message: e.to_string(),
                    uncertain: matches!(
                        e,
                        TagError::Store(locus_store::api::StoreError::CommitOutcomeUnknown(_))
                    ),
                })
            },
        )
        .await
    }
}
