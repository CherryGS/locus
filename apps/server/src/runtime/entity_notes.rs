use super::{registry::Shared, submissions::Arguments};
use crate::api::{
    core::{
        dto::{EntityNotes, WriteEntityNotes},
        mapping as map,
    },
    dto::MutationOutcome,
    error::{ApiError, DomainDiagnostic},
    store,
};
use locus_core::api::EntityId;
use std::sync::Arc;

impl Shared {
    pub async fn entity_notes(self: &Arc<Self>, entity: EntityId) -> Result<EntityNotes, ApiError> {
        let domain = self.business()?.clone();
        self.query("Read Entity notes", move |task| async move {
            let mut session = domain.database.session(&task).await.map_err(|e| {
                ApiError::domain(DomainDiagnostic::Store {
                    diagnostic: store::diagnostic(&e),
                })
            })?;
            domain
                .kernel
                .read_entity_notes(&mut session, entity)
                .await
                .map(|notes| EntityNotes {
                    entity_id: entity.to_string(),
                    notes,
                })
                .map_err(|e| ApiError::domain(map::core(e)))
        })
        .await
    }

    pub async fn write_entity_notes(
        self: &Arc<Self>,
        entity: EntityId,
        request: WriteEntityNotes,
    ) -> Result<MutationOutcome, ApiError> {
        let domain = self.business()?.clone();
        self.mutation(
            request.request_id,
            Arguments::WriteEntityNotes {
                entity,
                notes: request.notes.clone(),
            },
            "Save Entity notes",
            move |task| async move {
                let result = async {
                    let mut session = domain.database.session(&task).await.map_err(|e| {
                        DomainDiagnostic::Store {
                            diagnostic: store::diagnostic(&e),
                        }
                    })?;
                    domain
                        .kernel
                        .write_entity_notes(&mut session, entity, request.notes.clone())
                        .await
                        .map_err(map::core)?;
                    Ok(MutationOutcome::EntityNotesSaved {
                        notes: EntityNotes {
                            entity_id: entity.to_string(),
                            notes: request.notes,
                        },
                    })
                }
                .await;
                result.unwrap_or_else(|diagnostic| MutationOutcome::Failed { diagnostic })
            },
        )
        .await
    }
}
