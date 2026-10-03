use super::{registry::Shared, submissions::Arguments};
use crate::{
    api::{
        dto::MutationOutcome,
        error::ApiError,
        preferences::{
            card_cover_mapping as map, dto::EntityCardCoverPreference, mapping::failure,
        },
        store,
    },
    preferences::{
        identity::SavedRevision,
        record::{CardCoverOutcome, CardCoverSelection},
    },
};
use locus_core::api::EntityId;
use std::sync::Arc;

impl Shared {
    pub async fn card_cover_preference(
        self: &Arc<Self>,
        entity: EntityId,
    ) -> Result<EntityCardCoverPreference, ApiError> {
        let domain = self.business()?.clone();
        self.query(
            "Read Entity card cover preference",
            move |task| async move {
                let mut session = domain
                    .database
                    .session(&task)
                    .await
                    .map_err(store::failure)?;
                domain
                    .preferences
                    .read_card_cover(&mut session, entity)
                    .await
                    .map(map::observation)
                    .map_err(|e| ApiError::domain(failure(e)))
            },
        )
        .await
    }

    pub async fn card_cover_preferences(
        self: &Arc<Self>,
        entities: Vec<EntityId>,
    ) -> Result<Vec<EntityCardCoverPreference>, ApiError> {
        let domain = self.business()?.clone();
        self.query(
            "Read Entity card cover preference batch",
            move |task| async move {
                let mut session = domain
                    .database
                    .session(&task)
                    .await
                    .map_err(store::failure)?;
                domain
                    .preferences
                    .read_card_covers(&mut session, entities)
                    .await
                    .map(|v| v.into_iter().map(map::observation).collect())
                    .map_err(|e| ApiError::domain(failure(e)))
            },
        )
        .await
    }

    pub async fn update_card_cover_preference(
        self: &Arc<Self>,
        request_id: String,
        entity: EntityId,
        cover: Option<CardCoverSelection>,
        revision: Option<SavedRevision>,
    ) -> Result<MutationOutcome, ApiError> {
        let domain = self.business()?.clone();
        self.mutation(
            request_id,
            Arguments::UpdateCardCoverPreference {
                entity,
                cover: cover.clone(),
                revision,
            },
            "Save Entity card cover preference",
            move |task| async move {
                let result = async {
                    let mut session = domain
                        .database
                        .session(&task)
                        .await
                        .map_err(store::domain)?;
                    domain
                        .preferences
                        .update_card_cover(&mut session, entity, cover, revision)
                        .await
                        .map(|outcome| match outcome {
                            CardCoverOutcome::Saved(value) => {
                                MutationOutcome::CardCoverPreferenceSaved {
                                    preference: map::saved(value),
                                }
                            }
                            CardCoverOutcome::Conflict(current) => {
                                MutationOutcome::CardCoverPreferenceConflict {
                                    current: map::observation(current),
                                }
                            }
                            CardCoverOutcome::Missing(entity) => {
                                MutationOutcome::CardCoverPreferenceMissing {
                                    entity_id: entity.to_string(),
                                }
                            }
                        })
                        .map_err(failure)
                }
                .await;
                result.unwrap_or_else(|diagnostic| MutationOutcome::Failed { diagnostic })
            },
        )
        .await
    }
}
