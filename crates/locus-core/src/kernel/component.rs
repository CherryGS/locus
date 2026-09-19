use diesel::{OptionalExtension, sql_query, sql_types::Binary};
use diesel_async::RunQueryDsl;
use locus_store::api::{Context, Session};

use crate::{
    error::CoreError,
    identity::{ComponentId, KindId},
    persistence::rows::{CountRow, KindRow},
};

use super::registry::Kernel;

impl Kernel {
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

    pub(super) async fn require_component(
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
