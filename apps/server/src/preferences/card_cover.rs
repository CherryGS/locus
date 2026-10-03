use std::collections::HashMap;

use locus_core::api::EntityId;
use locus_store::api::{Context, Session};

use super::{
    error::PreferenceError,
    identity::SavedRevision,
    persistence,
    record::{CardCoverObservation, CardCoverOutcome, CardCoverSelection, SavedCardCover},
    service::PreferenceService,
};

impl PreferenceService {
    pub async fn read_card_cover(
        &self,
        session: &mut Session,
        entity: EntityId,
    ) -> Result<CardCoverObservation, PreferenceError> {
        let service = self.clone();
        session
            .transaction(move |context| {
                Box::pin(async move { service.read_card_cover_in(context, entity).await })
            })
            .await
    }

    pub async fn read_card_covers(
        &self,
        session: &mut Session,
        entities: Vec<EntityId>,
    ) -> Result<Vec<CardCoverObservation>, PreferenceError> {
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
                                let value = service.read_card_cover_in(context, entity).await?;
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

    async fn read_card_cover_in(
        &self,
        context: &mut Context,
        entity: EntityId,
    ) -> Result<CardCoverObservation, PreferenceError> {
        if !self.kernel.entity_exists_in(context, entity).await? {
            return Ok(CardCoverObservation::Missing(entity));
        }
        Ok(
            match persistence::card_cover::read(context, entity).await? {
                Some(value) => CardCoverObservation::Saved(value),
                None => CardCoverObservation::Unset(entity),
            },
        )
    }

    pub async fn update_card_cover(
        &self,
        session: &mut Session,
        entity: EntityId,
        cover: Option<CardCoverSelection>,
        expected_revision: Option<SavedRevision>,
    ) -> Result<CardCoverOutcome, PreferenceError> {
        let service = self.clone();
        session
            .transaction(move |context| {
                Box::pin(async move {
                    let current = service.read_card_cover_in(context, entity).await?;
                    let revision = match &current {
                        CardCoverObservation::Missing(entity) => {
                            return Ok(CardCoverOutcome::Missing(*entity));
                        }
                        CardCoverObservation::Unset(_) => None,
                        CardCoverObservation::Saved(value) => Some(value.revision),
                    };
                    if revision != expected_revision {
                        return Ok(CardCoverOutcome::Conflict(current));
                    }
                    let next = revision
                        .map_or(Some(1), |value| value.value().checked_add(1))
                        .ok_or(PreferenceError::RevisionExhausted(entity))?;
                    // A clear retains its revision: deleting the row would let a stale
                    // no-preference write overwrite a later save/clear cycle.
                    let saved = SavedCardCover {
                        entity,
                        cover,
                        revision: SavedRevision::new(next)?,
                    };
                    persistence::card_cover::write(context, &saved).await?;
                    Ok(CardCoverOutcome::Saved(saved))
                })
            })
            .await
    }
}
