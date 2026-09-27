use std::collections::HashMap;

use locus_core::api::{EntityId, Kernel};
use locus_store::api::{Context, Session};

use super::{
    error::PreferenceError,
    identity::{SavedRevision, ViewDefinitionId},
    persistence,
    record::{Observation, SavedPreference, UpdateOutcome},
};

#[derive(Clone)]
pub(crate) struct PreferenceService {
    kernel: Kernel,
}

impl PreferenceService {
    pub fn new(kernel: Kernel) -> Self {
        Self { kernel }
    }

    pub async fn read(
        &self,
        session: &mut Session,
        entity: EntityId,
    ) -> Result<Observation, PreferenceError> {
        let service = self.clone();
        session
            .transaction(move |context| {
                Box::pin(async move { service.read_in(context, entity).await })
            })
            .await
    }

    pub async fn read_batch(
        &self,
        session: &mut Session,
        entities: Vec<EntityId>,
    ) -> Result<Vec<Observation>, PreferenceError> {
        let service = self.clone();
        session
            .transaction(move |context| {
                Box::pin(async move {
                    let mut observed = HashMap::new();
                    let mut results = Vec::with_capacity(entities.len());
                    for entity in entities {
                        let value = match observed.get(&entity) {
                            Some(value) => value,
                            None => {
                                let value = service.read_in(context, entity).await?;
                                observed.entry(entity).or_insert(value)
                            }
                        };
                        results.push(value.clone());
                    }
                    Ok(results)
                })
            })
            .await
    }

    async fn read_in(
        &self,
        context: &mut Context,
        entity: EntityId,
    ) -> Result<Observation, PreferenceError> {
        if !self.kernel.entity_exists_in(context, entity).await? {
            return Ok(Observation::Missing(entity));
        }
        Ok(match persistence::record::read(context, entity).await? {
            Some(value) => Observation::Saved(value),
            None => Observation::Unset(entity),
        })
    }

    pub async fn update(
        &self,
        session: &mut Session,
        entity: EntityId,
        view_definition: ViewDefinitionId,
        expected_revision: Option<SavedRevision>,
    ) -> Result<UpdateOutcome, PreferenceError> {
        let service = self.clone();
        session
            .transaction(move |context| {
                Box::pin(async move {
                    let current = service.read_in(context, entity).await?;
                    let revision = match &current {
                        Observation::Missing(entity) => return Ok(UpdateOutcome::Missing(*entity)),
                        Observation::Unset(_) => None,
                        Observation::Saved(value) => Some(value.revision),
                    };
                    // Prepared old writes cannot overwrite a newer revision. A future UI
                    // coordinator must discard superseded intent and rebase only its current
                    // choice; retrying an obsolete choice against a fresh revision is unsafe.
                    // This backend neither retries nor rebases a conflicting operation.
                    if revision != expected_revision {
                        return Ok(UpdateOutcome::Conflict(current));
                    }
                    let next = revision
                        .map_or(Some(1), |value| value.value().checked_add(1))
                        .ok_or(PreferenceError::RevisionExhausted(entity))?;
                    let saved = SavedPreference {
                        entity,
                        view_definition,
                        revision: SavedRevision::new(next)?,
                    };
                    persistence::record::write(context, &saved).await?;
                    Ok(UpdateOutcome::Saved(saved))
                })
            })
            .await
    }
}
