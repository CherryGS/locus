use diesel::{
    OptionalExtension, sql_query,
    sql_types::{Binary, Text},
};
use diesel_async::RunQueryDsl;
use locus_store::api::{Context, Session};

use super::registry::Kernel;
use crate::{error::CoreError, identity::EntityId, persistence::rows::NotesRow};

impl Kernel {
    /// Personal plain-text notes belong to the Entity, independently of its components.
    pub async fn read_entity_notes(
        &self,
        session: &mut Session,
        entity: EntityId,
    ) -> Result<String, CoreError> {
        let kernel = self.clone();
        session
            .transaction(move |context| {
                Box::pin(async move { kernel.read_entity_notes_in(context, entity).await })
            })
            .await
    }

    pub async fn read_entity_notes_in(
        &self,
        context: &mut Context,
        entity: EntityId,
    ) -> Result<String, CoreError> {
        sql_query("SELECT notes FROM locus_core_comm_entity WHERE id = ?")
            .bind::<Binary, _>(entity.as_bytes().as_slice())
            .get_result::<NotesRow>(context.connection())
            .await
            .optional()?
            .map(|row| row.notes)
            .ok_or(CoreError::MissingEntity(entity))
    }

    pub async fn write_entity_notes(
        &self,
        session: &mut Session,
        entity: EntityId,
        notes: String,
    ) -> Result<(), CoreError> {
        let kernel = self.clone();
        session
            .transaction(move |context| {
                Box::pin(async move { kernel.write_entity_notes_in(context, entity, &notes).await })
            })
            .await
    }

    pub async fn write_entity_notes_in(
        &self,
        context: &mut Context,
        entity: EntityId,
        notes: &str,
    ) -> Result<(), CoreError> {
        let count = sql_query("UPDATE locus_core_comm_entity SET notes = ? WHERE id = ?")
            .bind::<Text, _>(notes)
            .bind::<Binary, _>(entity.as_bytes().as_slice())
            .execute(context.connection())
            .await?;
        if count == 0 {
            return Err(CoreError::MissingEntity(entity));
        }
        Ok(())
    }
}
