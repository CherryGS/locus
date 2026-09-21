use locus_core::api::EntityId;

use super::identity::{SavedRevision, ViewDefinitionId};

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
