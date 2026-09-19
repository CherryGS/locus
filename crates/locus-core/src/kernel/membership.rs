use diesel::{OptionalExtension, sql_query, sql_types::Binary};
use diesel_async::RunQueryDsl;
use locus_store::api::{Context, Session};

use crate::{
    error::CoreError,
    identity::{ComponentId, EntityId, KindId},
    persistence::rows::{IdRow, MembershipRow},
    record::{AttachOutcome, Membership},
};

use super::registry::Kernel;

impl Kernel {
    /// Resolve a component's actual host without requiring its concrete owner.
    /// Unknown components are errors; admitted detached components return None.
    pub async fn attachment(
        &self,
        session: &mut Session,
        component: ComponentId,
    ) -> Result<Option<Membership>, CoreError> {
        let kernel = self.clone();
        session
            .transaction(move |context| {
                Box::pin(async move { kernel.attachment_in(context, component).await })
            })
            .await
    }

    pub async fn attachment_in(
        &self,
        context: &mut Context,
        component: ComponentId,
    ) -> Result<Option<Membership>, CoreError> {
        self.component_kind_in(context, component).await?;
        let row =
            sql_query("SELECT entity, kind, component FROM locus_memberships WHERE component = ?")
                .bind::<Binary, _>(component.as_bytes().as_slice())
                .get_result::<MembershipRow>(context.connection())
                .await
                .optional()?;
        row.map(|row| {
            Ok(Membership {
                entity: EntityId::from_bytes(&row.entity)?,
                kind: KindId::from_bytes(&row.kind)?,
                component: ComponentId::from_bytes(&row.component)?,
            })
        })
        .transpose()
    }

    pub async fn attach(
        &self,
        session: &mut Session,
        membership: Membership,
    ) -> Result<AttachOutcome, CoreError> {
        let kernel = self.clone();
        session
            .transaction(move |context| {
                Box::pin(async move { kernel.attach_in(context, membership).await })
            })
            .await
    }

    pub async fn memberships(
        &self,
        session: &mut Session,
        entity: EntityId,
    ) -> Result<Vec<Membership>, CoreError> {
        let kernel = self.clone();
        session
            .transaction(move |context| {
                Box::pin(async move { kernel.memberships_in(context, entity).await })
            })
            .await
    }

    /// Returns false for an absent/stale exact membership; never detaches a replacement.
    pub async fn detach(
        &self,
        session: &mut Session,
        membership: Membership,
    ) -> Result<bool, CoreError> {
        let kernel = self.clone();
        session
            .transaction(move |context| {
                Box::pin(async move { kernel.detach_in(context, membership).await })
            })
            .await
    }

    pub async fn attach_in(
        &self,
        context: &mut Context,
        membership: Membership,
    ) -> Result<AttachOutcome, CoreError> {
        let Membership {
            entity,
            kind,
            component,
        } = membership;
        self.require_entity(context, entity).await?;
        self.require_component(context, kind, component).await?;
        let existing = sql_query(
            "SELECT component AS id FROM locus_memberships WHERE entity = ? AND kind = ?",
        )
        .bind::<Binary, _>(entity.as_bytes().as_slice())
        .bind::<Binary, _>(kind.as_bytes().as_slice())
        .get_result::<IdRow>(context.connection())
        .await
        .optional()?;
        if let Some(existing) = existing {
            let existing = ComponentId::from_bytes(&existing.id)?;
            return if existing == component {
                Ok(AttachOutcome::AlreadyAttached)
            } else {
                Err(CoreError::SlotOccupied(existing))
            };
        }
        let attached =
            sql_query("SELECT entity, kind, component FROM locus_memberships WHERE component = ?")
                .bind::<Binary, _>(component.as_bytes().as_slice())
                .get_result::<MembershipRow>(context.connection())
                .await
                .optional()?;
        if let Some(attached) = attached {
            return Err(CoreError::AttachmentOccupied(Membership {
                entity: EntityId::from_bytes(&attached.entity)?,
                kind: KindId::from_bytes(&attached.kind)?,
                component: ComponentId::from_bytes(&attached.component)?,
            }));
        }
        sql_query("INSERT INTO locus_memberships (entity, kind, component) VALUES (?, ?, ?)")
            .bind::<Binary, _>(entity.as_bytes().as_slice())
            .bind::<Binary, _>(kind.as_bytes().as_slice())
            .bind::<Binary, _>(component.as_bytes().as_slice())
            .execute(context.connection())
            .await?;
        Ok(AttachOutcome::Attached)
    }

    /// Membership metadata remains readable even when a domain capability is absent.
    pub async fn memberships_in(
        &self,
        context: &mut Context,
        entity: EntityId,
    ) -> Result<Vec<Membership>, CoreError> {
        self.require_entity(context, entity).await?;
        let rows = sql_query(
            "SELECT entity, kind, component FROM locus_memberships WHERE entity = ? ORDER BY kind",
        )
        .bind::<Binary, _>(entity.as_bytes().as_slice())
        .load::<MembershipRow>(context.connection())
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(Membership {
                    entity: EntityId::from_bytes(&row.entity)?,
                    kind: KindId::from_bytes(&row.kind)?,
                    component: ComponentId::from_bytes(&row.component)?,
                })
            })
            .collect()
    }

    pub async fn detach_in(
        &self,
        context: &mut Context,
        membership: Membership,
    ) -> Result<bool, CoreError> {
        self.require_entity(context, membership.entity).await?;
        let count = sql_query(
            "DELETE FROM locus_memberships WHERE entity = ? AND kind = ? AND component = ?",
        )
        .bind::<Binary, _>(membership.entity.as_bytes().as_slice())
        .bind::<Binary, _>(membership.kind.as_bytes().as_slice())
        .bind::<Binary, _>(membership.component.as_bytes().as_slice())
        .execute(context.connection())
        .await?;
        Ok(count == 1)
    }
}
