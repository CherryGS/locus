use locus_core::api::{ComponentId, EntityId};

use super::identity::{CivitaiVersionId, SavedRevision, ViewDefinitionId};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SavedPreference {
    pub entity: EntityId,
    pub view_definition: ViewDefinitionId,
    pub revision: SavedRevision,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Observation {
    Saved(SavedPreference),
    Unset(EntityId),
    Missing(EntityId),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum UpdateOutcome {
    Saved(SavedPreference),
    Conflict(Observation),
    Missing(EntityId),
}

/// Retained UI intent; these references do not assert a provider relationship.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CardCoverSelection {
    pub source: ComponentId,
    pub version: CivitaiVersionId,
    pub target: EntityId,
    pub file: ComponentId,
    pub image: ComponentId,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SavedCardCover {
    pub entity: EntityId,
    pub cover: Option<CardCoverSelection>,
    pub revision: SavedRevision,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum CardCoverObservation {
    Saved(SavedCardCover),
    Unset(EntityId),
    Missing(EntityId),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum CardCoverOutcome {
    Saved(SavedCardCover),
    Conflict(CardCoverObservation),
    Missing(EntityId),
}
