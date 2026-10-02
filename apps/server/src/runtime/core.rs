use super::{registry::Shared, submissions::Arguments};
use crate::api::{
    core::{dto::*, mapping as map},
    dto::MutationOutcome,
    error::ApiError,
    store,
};
use locus_core::api::{EntityId, Membership as CoreMembership};
use std::sync::Arc;
impl Shared {
    pub async fn entity_ids(self: &Arc<Self>) -> Result<Vec<u8>, ApiError> {
        let domain = self.business()?.clone();
        self.query("Enumerate Entity identities", move |task| async move {
            let mut session = domain
                .database
                .session(&task)
                .await
                .map_err(store::failure)?;
            domain
                .kernel
                .entity_ids(&mut session)
                .await
                .map(|ids| ids.into_bytes())
                .map_err(|e| ApiError::domain(map::core(e)))
        })
        .await
    }

    pub async fn memberships_batch(
        self: &Arc<Self>,
        entities: Vec<EntityId>,
    ) -> Result<Vec<EntityMemberships>, ApiError> {
        let domain = self.business()?.clone();
        self.query("Read membership batch", move |task| async move {
            let mut session = domain
                .database
                .session(&task)
                .await
                .map_err(store::failure)?;
            domain
                .kernel
                .memberships_batch(&mut session, &entities)
                .await
                .map(|rows| {
                    rows.into_iter()
                        .map(|row| match row.memberships {
                            Some(memberships) => EntityMemberships::Present {
                                entity_id: row.entity.to_string(),
                                memberships: memberships.into_iter().map(map::membership).collect(),
                            },
                            None => EntityMemberships::Missing {
                                entity_id: row.entity.to_string(),
                            },
                        })
                        .collect()
                })
                .map_err(|e| ApiError::domain(map::core(e)))
        })
        .await
    }

    pub async fn create_entity(self: &Arc<Self>, id: String) -> Result<MutationOutcome, ApiError> {
        let domain = self.business()?.clone();
        self.mutation(
            id,
            Arguments::CreateEntity,
            "Create entity",
            move |task| async move {
                let result = async {
                    let mut session = domain
                        .database
                        .session(&task)
                        .await
                        .map_err(store::domain)?;
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
    pub async fn membership(
        self: &Arc<Self>,
        request: ChangeMembership,
        membership: CoreMembership,
        attach: bool,
    ) -> Result<MutationOutcome, ApiError> {
        let domain = self.business()?.clone();
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
                    let mut session = domain
                        .database
                        .session(&task)
                        .await
                        .map_err(store::domain)?;
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
        let domain = self.business()?.clone();
        self.query("Read memberships", move |task| async move {
            let mut session = domain
                .database
                .session(&task)
                .await
                .map_err(store::failure)?;
            domain
                .kernel
                .memberships(&mut session, entity)
                .await
                .map(|v| v.into_iter().map(map::membership).collect())
                .map_err(|e| ApiError::domain(map::core(e)))
        })
        .await
    }
}
