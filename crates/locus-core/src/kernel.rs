use std::{collections::HashMap, sync::Arc};

use diesel::{
    OptionalExtension, QueryableByName, sql_query,
    sql_types::{BigInt, Binary},
};
use diesel_async::RunQueryDsl;
use locus_store::{Context, Session};

use crate::{ComponentId, CoreError, EntityId, KindId, KindOwner, schema};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachOutcome {
    Attached,
    AlreadyAttached,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Membership {
    pub entity: EntityId,
    pub kind: KindId,
    pub component: ComponentId,
}

/// Generic identity and membership authority. Registration supplies domain
/// capabilities; it neither creates payload tables nor defines their semantics.
/// Methods ending in `_in` participate in a caller-owned transaction. Other async
/// methods establish and commit their own unit through the supplied session.
#[derive(Clone, Default)]
pub struct Kernel {
    owners: HashMap<KindId, Arc<dyn KindOwner>>,
}

#[derive(QueryableByName)]
struct IdRow {
    #[diesel(sql_type = Binary)]
    id: Vec<u8>,
}
#[derive(QueryableByName)]
struct KindRow {
    #[diesel(sql_type = Binary)]
    kind: Vec<u8>,
}
#[derive(QueryableByName)]
struct CountRow {
    #[diesel(sql_type = BigInt)]
    count: i64,
}
#[derive(QueryableByName)]
struct MembershipRow {
    #[diesel(sql_type = Binary)]
    entity: Vec<u8>,
    #[diesel(sql_type = Binary)]
    kind: Vec<u8>,
    #[diesel(sql_type = Binary)]
    component: Vec<u8>,
}

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

    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, owner: Arc<dyn KindOwner>) -> Result<(), CoreError> {
        let kind = owner.kind();
        if self.owners.contains_key(&kind) {
            return Err(CoreError::DuplicateKind(kind));
        }
        self.owners.insert(kind, owner);
        Ok(())
    }

    pub async fn initialize(&self, session: &mut Session) -> Result<(), CoreError> {
        session
            .transaction(|context| Box::pin(schema::initialize(context)))
            .await
    }

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

    pub async fn component_kind(
        &self,
        session: &mut Session,
        component: ComponentId,
    ) -> Result<KindId, CoreError> {
        let kernel = self.clone();
        session
            .transaction(move |context| {
                Box::pin(async move { kernel.component_kind_in(context, component).await })
            })
            .await
    }

    pub async fn admit_component(
        &self,
        session: &mut Session,
        kind: KindId,
        component: ComponentId,
    ) -> Result<(), CoreError> {
        let kernel = self.clone();
        session
            .transaction(move |context| {
                Box::pin(async move { kernel.admit_component_in(context, kind, component).await })
            })
            .await
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

    pub async fn delete_component(
        &self,
        session: &mut Session,
        kind: KindId,
        component: ComponentId,
    ) -> Result<(), CoreError> {
        let kernel = self.clone();
        session
            .transaction(move |context| {
                Box::pin(async move { kernel.delete_component_in(context, kind, component).await })
            })
            .await
    }

    pub async fn create_entity_in(&self, context: &mut Context) -> Result<EntityId, CoreError> {
        let id = EntityId::new();
        sql_query("INSERT INTO locus_entities (id) VALUES (?)")
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
        let row = sql_query("SELECT id FROM locus_entities WHERE id = ?")
            .bind::<Binary, _>(entity.as_bytes().as_slice())
            .get_result::<IdRow>(context.connection())
            .await
            .optional()?;
        Ok(row
            .map(|row| EntityId::from_bytes(&row.id))
            .transpose()?
            .is_some())
    }

    pub async fn component_kind_in(
        &self,
        context: &mut Context,
        component: ComponentId,
    ) -> Result<KindId, CoreError> {
        let row = sql_query("SELECT kind FROM locus_components WHERE id = ?")
            .bind::<Binary, _>(component.as_bytes().as_slice())
            .get_result::<KindRow>(context.connection())
            .await
            .optional()?
            .ok_or(CoreError::MissingComponent(component))?;
        Ok(KindId::from_bytes(&row.kind)?)
    }

    pub async fn admit_component_in(
        &self,
        context: &mut Context,
        kind: KindId,
        component: ComponentId,
    ) -> Result<(), CoreError> {
        let owner = self.owner(kind)?;
        match self.component_kind_in(context, component).await {
            Ok(actual) if actual != kind => {
                return Err(CoreError::KindMismatch {
                    component,
                    actual,
                    requested: kind,
                });
            }
            Ok(_) | Err(CoreError::MissingComponent(_)) => (),
            Err(error) => return Err(error),
        }
        if !owner.exists(context, component).await? {
            return Err(CoreError::MissingComponent(component));
        }
        sql_query("INSERT OR IGNORE INTO locus_components (id, kind) VALUES (?, ?)")
            .bind::<Binary, _>(component.as_bytes().as_slice())
            .bind::<Binary, _>(kind.as_bytes().as_slice())
            .execute(context.connection())
            .await?;
        Ok(())
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

    pub async fn delete_entity_in(
        &self,
        context: &mut Context,
        entity: EntityId,
    ) -> Result<(), CoreError> {
        let count = sql_query("DELETE FROM locus_entities WHERE id = ?")
            .bind::<Binary, _>(entity.as_bytes().as_slice())
            .execute(context.connection())
            .await?;
        if count == 0 {
            return Err(CoreError::MissingEntity(entity));
        }
        Ok(())
    }

    pub async fn delete_component_in(
        &self,
        context: &mut Context,
        kind: KindId,
        component: ComponentId,
    ) -> Result<(), CoreError> {
        let kernel = self.clone();
        // Owner payload writes and core removal form one participant even if an
        // operation owner catches its rejection and commits other work in the group.
        context
            .savepoint(move |context| {
                Box::pin(async move {
                    kernel.require_component(context, kind, component).await?;
                    let row = sql_query(
                        "SELECT count(*) AS count FROM locus_memberships WHERE component = ?",
                    )
                    .bind::<Binary, _>(component.as_bytes().as_slice())
                    .get_result::<CountRow>(context.connection())
                    .await?;
                    if row.count != 0 {
                        return Err(CoreError::ComponentAttached(component));
                    }
                    kernel.owner(kind)?.delete(context, component).await?;
                    sql_query("DELETE FROM locus_components WHERE id = ? AND kind = ?")
                        .bind::<Binary, _>(component.as_bytes().as_slice())
                        .bind::<Binary, _>(kind.as_bytes().as_slice())
                        .execute(context.connection())
                        .await?;
                    Ok(())
                })
            })
            .await
    }

    fn owner(&self, kind: KindId) -> Result<&Arc<dyn KindOwner>, CoreError> {
        self.owners
            .get(&kind)
            .ok_or(CoreError::UnavailableKind(kind))
    }

    async fn require_entity(
        &self,
        context: &mut Context,
        entity: EntityId,
    ) -> Result<(), CoreError> {
        if !self.entity_exists_in(context, entity).await? {
            return Err(CoreError::MissingEntity(entity));
        }
        Ok(())
    }

    async fn require_component(
        &self,
        context: &mut Context,
        kind: KindId,
        component: ComponentId,
    ) -> Result<(), CoreError> {
        let owner = self.owner(kind)?;
        let actual = self.component_kind_in(context, component).await?;
        if actual != kind {
            return Err(CoreError::KindMismatch {
                component,
                actual,
                requested: kind,
            });
        }
        if !owner.exists(context, component).await? {
            return Err(CoreError::MissingComponent(component));
        }
        Ok(())
    }
}
