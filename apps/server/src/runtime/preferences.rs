use super::{registry::Shared, submissions::Arguments};
use crate::{
    api::{
        dto::MutationOutcome,
        error::{ApiError, DomainDiagnostic},
        preferences::{dto::EntityViewPreference, mapping as map},
        store,
    },
    preferences::{
        identity::{SavedRevision, ViewDefinitionId},
        record::UpdateOutcome,
    },
};
use locus_core::api::EntityId;
use std::sync::Arc;

impl Shared {
    pub async fn view_preference(
        self: &Arc<Self>,
        entity: EntityId,
    ) -> Result<EntityViewPreference, ApiError> {
        let domain = self.business()?.clone();
        self.query("Read Entity view preference", move |task| async move {
            let mut session = domain.database.session(&task).await.map_err(|error| {
                ApiError::domain(DomainDiagnostic::Store {
                    diagnostic: store::diagnostic(&error),
                })
            })?;
            domain
                .preferences
                .read(&mut session, entity)
                .await
                .map(map::observation)
                .map_err(|error| ApiError::domain(map::failure(error)))
        })
        .await
    }

    pub async fn view_preferences(
        self: &Arc<Self>,
        entities: Vec<EntityId>,
    ) -> Result<Vec<EntityViewPreference>, ApiError> {
        let domain = self.business()?.clone();
        self.query(
            "Read Entity view preference batch",
            move |task| async move {
                let mut session = domain.database.session(&task).await.map_err(|error| {
                    ApiError::domain(DomainDiagnostic::Store {
                        diagnostic: store::diagnostic(&error),
                    })
                })?;
                domain
                    .preferences
                    .read_batch(&mut session, entities)
                    .await
                    .map(|values| values.into_iter().map(map::observation).collect())
                    .map_err(|error| ApiError::domain(map::failure(error)))
            },
        )
        .await
    }

    pub async fn update_view_preference(
        self: &Arc<Self>,
        request_id: String,
        entity: EntityId,
        view: ViewDefinitionId,
        revision: Option<SavedRevision>,
    ) -> Result<MutationOutcome, ApiError> {
        let domain = self.business()?.clone();
        self.mutation(
            request_id,
            Arguments::UpdateViewPreference {
                entity,
                view: view.clone(),
                revision,
            },
            "Save Entity view preference",
            move |task| async move {
                let result = async {
                    let mut session = domain.database.session(&task).await.map_err(|error| {
                        DomainDiagnostic::Store {
                            diagnostic: store::diagnostic(&error),
                        }
                    })?;
                    domain
                        .preferences
                        .update(&mut session, entity, view, revision)
                        .await
                        .map(|outcome| match outcome {
                            UpdateOutcome::Saved(value) => MutationOutcome::ViewPreferenceSaved {
                                preference: map::saved(value),
                            },
                            UpdateOutcome::Conflict(current) => {
                                MutationOutcome::ViewPreferenceConflict {
                                    current: map::observation(current),
                                }
                            }
                            UpdateOutcome::Missing(entity) => {
                                MutationOutcome::ViewPreferenceMissing {
                                    entity_id: entity.to_string(),
                                }
                            }
                        })
                        .map_err(map::failure)
                }
                .await;
                result.unwrap_or_else(|diagnostic| MutationOutcome::Failed { diagnostic })
            },
        )
        .await
    }
}
