use diesel::{RunQueryDsl, sql_query, sql_types::Binary};
use locus_store::api::{Context, Session};
use std::collections::HashMap;

use super::registry::Kernel;
use crate::{
    error::CoreError,
    identity::{ComponentId, EntityId, KindId},
    persistence::rows::{CountRow, EntityMembershipRow, IdRow},
    record::{EntityIds, EntityMemberships, Membership},
};

impl Kernel {
    /// A complete observation of Entity identities, including empty Entities.
    /// Sequence order has no business meaning and may differ between reads.
    pub async fn entity_ids(&self, session: &mut Session) -> Result<EntityIds, CoreError> {
        let kernel = self.clone();
        session
            .transaction(move |context| {
                Box::pin(async move { kernel.entity_ids_in(context).await })
            })
            .await
    }

    pub async fn entity_ids_in(&self, context: &mut Context) -> Result<EntityIds, CoreError> {
        // The wrapper's async load collects owned rows before yielding any. Use
        // its supported blocking callback to decode one row at a time instead.
        // Count and scan share the caller's transaction; no HTTP body retains it.
        context
            .connection()
            .spawn_blocking(|connection| {
                Ok((|| -> Result<EntityIds, CoreError> {
                    let count = sql_query("SELECT count(*) AS count FROM locus_entities")
                        .get_result::<CountRow>(connection)?
                        .count;
                    let mut bytes = Vec::with_capacity(count as usize * 16);
                    for row in sql_query("SELECT id FROM locus_entities")
                        .load_iter::<IdRow, _>(connection)?
                    {
                        let id = EntityId::from_bytes(&row?.id)?;
                        bytes.extend_from_slice(id.as_bytes());
                    }
                    Ok(EntityIds::from_validated_bytes(bytes))
                })())
            })
            .await?
    }

    /// One outcome per input position, in input order, including duplicates.
    /// No owner or payload capability is needed. An overall database/decode
    /// failure returns Err, never a partial successful batch.
    pub async fn memberships_batch(
        &self,
        session: &mut Session,
        entities: &[EntityId],
    ) -> Result<Vec<EntityMemberships>, CoreError> {
        let kernel = self.clone();
        let entities = entities.to_vec();
        session
            .transaction(move |context| {
                Box::pin(async move { kernel.memberships_batch_in(context, &entities).await })
            })
            .await
    }

    pub async fn memberships_batch_in(
        &self,
        context: &mut Context,
        entities: &[EntityId],
    ) -> Result<Vec<EntityMemberships>, CoreError> {
        let mut observed: HashMap<EntityId, Vec<Membership>> = HashMap::new();
        // Private bind chunking stays below SQLite's historical 999-variable
        // floor. All chunks share this transaction, with no public item quota.
        for chunk in entities.chunks(500) {
            let placeholders = vec!["?"; chunk.len()].join(",");
            let mut query = sql_query(format!(
                "SELECT e.id AS entity, m.kind, m.component FROM locus_entities e \
                 LEFT JOIN locus_memberships m ON m.entity = e.id WHERE e.id IN ({placeholders})"
            ))
            .into_boxed();
            for entity in chunk {
                query = query.bind::<Binary, _>(entity.as_bytes().as_slice());
            }
            let rows =
                diesel_async::RunQueryDsl::load::<EntityMembershipRow>(query, context.connection())
                    .await?;
            // Duplicates crossing chunks must not multiply memberships.
            let mut part: HashMap<EntityId, Vec<Membership>> = HashMap::new();
            for row in rows {
                let entity = EntityId::from_bytes(&row.entity)?;
                let memberships = part.entry(entity).or_default();
                match (row.kind, row.component) {
                    (Some(kind), Some(component)) => memberships.push(Membership {
                        entity,
                        kind: KindId::from_bytes(&kind)?,
                        component: ComponentId::from_bytes(&component)?,
                    }),
                    (None, None) => (),
                    _ => {
                        return Err(diesel::result::Error::DeserializationError(
                            "incomplete persisted membership".into(),
                        )
                        .into());
                    }
                }
            }
            observed.extend(part);
        }
        Ok(entities
            .iter()
            .map(|entity| EntityMemberships {
                entity: *entity,
                memberships: observed.get(entity).cloned(),
            })
            .collect())
    }
}
