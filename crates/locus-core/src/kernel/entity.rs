use diesel::{OptionalExtension, sql_query, sql_types::Binary};
use diesel_async::RunQueryDsl;
use locus_store::api::{Context, Session};

use crate::{error::CoreError, identity::EntityId, persistence::rows::IdRow};

use super::registry::Kernel;

impl Kernel {
    pub async fn create_entity(&self, session: &mut Session) -> Result<EntityId, CoreError> {
        let kernel = self.clone();
        session
            .transaction(move |context| {
                Box::pin(async move { kernel.create_entity_in(context).await })
            })
            .await
    }

    pub async fn entity_exists(
        &self,
        session: &mut Session,
        entity: EntityId,
    ) -> Result<bool, CoreError> {
        let kernel = self.clone();
        session
            .transaction(move |context| {
                Box::pin(async move { kernel.entity_exists_in(context, entity).await })
            })
            .await
    }

    pub async fn delete_entity(
        &self,
        session: &mut Session,
        entity: EntityId,
    ) -> Result<(), CoreError> {
        let kernel = self.clone();
        session
            .transaction(move |context| {
                Box::pin(async move { kernel.delete_entity_in(context, entity).await })
            })
            .await
    }

    pub async fn create_entity_in(&self, context: &mut Context) -> Result<EntityId, CoreError> {
        let id = EntityId::new();
        sql_query("INSERT INTO locus_core_comm_entity (id) VALUES (?)")
            .bind::<Binary, _>(id.as_bytes().as_slice())
            .execute(context.connection())
            .await?;
        Ok(id)
    }

    pub async fn entity_exists_in(
        &self,
        context: &mut Context,
        entity: EntityId,
    ) -> Result<bool, CoreError> {
        let row = sql_query("SELECT id FROM locus_core_comm_entity WHERE id = ?")
            .bind::<Binary, _>(entity.as_bytes().as_slice())
            .get_result::<IdRow>(context.connection())
            .await
            .optional()?;
        Ok(row
            .map(|row| EntityId::from_bytes(&row.id))
            .transpose()?
            .is_some())
    }

    pub async fn delete_entity_in(
        &self,
        context: &mut Context,
        entity: EntityId,
    ) -> Result<(), CoreError> {
        let count = sql_query("DELETE FROM locus_core_comm_entity WHERE id = ?")
            .bind::<Binary, _>(entity.as_bytes().as_slice())
            .execute(context.connection())
            .await?;
        if count == 0 {
            return Err(CoreError::MissingEntity(entity));
        }
        Ok(())
    }

    pub(super) async fn require_entity(
        &self,
        context: &mut Context,
        entity: EntityId,
    ) -> Result<(), CoreError> {
        if !self.entity_exists_in(context, entity).await? {
            return Err(CoreError::MissingEntity(entity));
        }
        Ok(())
    }
}
