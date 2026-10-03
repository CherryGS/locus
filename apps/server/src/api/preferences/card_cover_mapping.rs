use locus_core::api::ComponentId;

use super::dto::{CardCoverSelection, EntityCardCoverPreference, SavedCardCoverPreference};
use crate::{
    api::{core::mapping::entity, error::ApiError, request::canonical_id},
    preferences::{
        identity::{CivitaiVersionId, SavedRevision},
        record::{self, CardCoverObservation, SavedCardCover},
    },
};

pub(crate) fn input(
    cover: Option<CardCoverSelection>,
    revision: Option<&str>,
) -> Result<(Option<record::CardCoverSelection>, Option<SavedRevision>), ApiError> {
    let component = |id: &str| {
        ComponentId::from_bytes(canonical_id(id)?.as_bytes())
            .map_err(|_| ApiError::invalid("component_id must be UUIDv7"))
    };
    let cover = cover
        .map(|c| {
            Ok(record::CardCoverSelection {
                source: component(&c.source_component_id)?,
                version: CivitaiVersionId::new(c.version_id)
                    .map_err(|e| ApiError::invalid(e.to_string()))?,
                target: entity(&c.target_entity_id)?,
                file: component(&c.target_file_id)?,
                image: component(&c.image_component_id)?,
            })
        })
        .transpose()?;
    let revision = revision
        .map(SavedRevision::from_decimal)
        .transpose()
        .map_err(|e| ApiError::invalid(e.to_string()))?;
    Ok((cover, revision))
}

fn selection(c: record::CardCoverSelection) -> CardCoverSelection {
    CardCoverSelection {
        source_component_id: c.source.to_string(),
        version_id: c.version.as_str().into(),
        target_entity_id: c.target.to_string(),
        target_file_id: c.file.to_string(),
        image_component_id: c.image.to_string(),
    }
}
pub(crate) fn saved(value: SavedCardCover) -> SavedCardCoverPreference {
    SavedCardCoverPreference {
        entity_id: value.entity.to_string(),
        cover: value.cover.map(selection),
        revision: value.revision.value().to_string(),
    }
}
pub(crate) fn observation(value: CardCoverObservation) -> EntityCardCoverPreference {
    match value {
        CardCoverObservation::Saved(value) => {
            let value = saved(value);
            EntityCardCoverPreference::Saved {
                entity_id: value.entity_id,
                cover: value.cover,
                revision: value.revision,
            }
        }
        CardCoverObservation::Unset(entity) => EntityCardCoverPreference::Unset {
            entity_id: entity.to_string(),
        },
        CardCoverObservation::Missing(entity) => EntityCardCoverPreference::Missing {
            entity_id: entity.to_string(),
        },
    }
}
