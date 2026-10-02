use super::dto::*;
use crate::{
    api::{
        dto::MutationOutcome,
        error::ApiError,
        request::{body, canonical_id},
    },
    runtime::Shared,
};
use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection},
};
use std::sync::Arc;
fn tag(id: &str) -> Result<locus_tag::api::TagId, ApiError> {
    locus_tag::api::TagId::from_bytes(canonical_id(id)?.as_bytes())
        .map_err(|e| ApiError::invalid(e.to_string()))
}
fn entity(id: &str) -> Result<locus_core::api::EntityId, ApiError> {
    locus_core::api::EntityId::from_bytes(canonical_id(id)?.as_bytes())
        .map_err(|e| ApiError::invalid(e.to_string()))
}
#[utoipa::path(get,path="/api/v1/tags",tag="tag",responses((status=200,body=Vec<TagRecord>)))]
async fn list_tags(State(s): State<Arc<Shared>>) -> Result<Json<Vec<TagRecord>>, ApiError> {
    s.tags().await.map(Json)
}
#[utoipa::path(get,path="/api/v1/tags/{id}",tag="tag",params(("id"=String,Path)),responses((status=200,body=TagRecord)))]
async fn read_tag(
    State(s): State<Arc<Shared>>,
    Path(id): Path<String>,
) -> Result<Json<TagRecord>, ApiError> {
    s.tag_read(tag(&id)?).await.map(Json)
}
#[utoipa::path(get,path="/api/v1/tags/{id}/document",tag="tag",params(("id"=String,Path)),responses((status=200,body=TagDocument)))]
async fn read_tag_document(
    State(s): State<Arc<Shared>>,
    Path(id): Path<String>,
) -> Result<Json<TagDocument>, ApiError> {
    s.tag_document(tag(&id)?).await.map(Json)
}
#[utoipa::path(get,path="/api/v1/entities/{id}/tags",tag="tag",params(("id"=String,Path)),responses((status=200,body=EntityTags)))]
async fn entity_tags(
    State(s): State<Arc<Shared>>,
    Path(id): Path<String>,
) -> Result<Json<EntityTags>, ApiError> {
    s.entity_tags(entity(&id)?).await.map(Json)
}
#[utoipa::path(get,path="/api/v1/tag-sets/{id}",tag="tag",params(("id"=String,Path)),responses((status=200,body=TagSetRecord)))]
async fn read_tag_set(
    State(s): State<Arc<Shared>>,
    Path(id): Path<String>,
) -> Result<Json<TagSetRecord>, ApiError> {
    let id = locus_core::api::ComponentId::from_bytes(canonical_id(&id)?.as_bytes())
        .map_err(|e| ApiError::invalid(e.to_string()))?;
    s.tag_set(id).await.map(Json)
}
#[utoipa::path(post,path="/api/v1/tags",tag="tag",request_body=WriteTag,responses((status=200,body=MutationOutcome)))]
async fn write_tag(
    State(s): State<Arc<Shared>>,
    input: Result<Json<WriteTag>, JsonRejection>,
) -> Result<Json<MutationOutcome>, ApiError> {
    let input = body(input)?;
    canonical_id(&input.request_id)?;
    match &input.change {
        TagChange::Create { parent, .. } => {
            if let Some(id) = parent {
                tag(id)?;
            }
        }
        TagChange::Move {
            id,
            revision,
            parent,
        } => {
            tag(id)?;
            canonical_id(revision)?;
            if let Some(id) = parent {
                tag(id)?;
            }
        }
        TagChange::Rename { id, revision, .. }
        | TagChange::Markdown { id, revision, .. }
        | TagChange::Delete { id, revision } => {
            tag(id)?;
            canonical_id(revision)?;
        }
        TagChange::Add { entity_id, tag_id } | TagChange::Remove { entity_id, tag_id } => {
            entity(entity_id)?;
            tag(tag_id)?;
        }
    }
    s.tag_write(input.request_id, input.change).await.map(Json)
}
pub(crate) fn router() -> utoipa_axum::router::OpenApiRouter<Arc<Shared>> {
    use utoipa_axum::{router::OpenApiRouter, routes};
    OpenApiRouter::new()
        .routes(routes!(list_tags, write_tag))
        .routes(routes!(read_tag))
        .routes(routes!(read_tag_document))
        .routes(routes!(entity_tags))
        .routes(routes!(read_tag_set))
}
