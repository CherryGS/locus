use crate::{error::TagError, identity::TagId, persistence, record::TagRecord};
use diesel::{
    QueryableByName, sql_query,
    sql_types::{Binary, Nullable, Text},
};
use diesel_async::RunQueryDsl;
use locus_store::api::Context;
use std::collections::{HashMap, HashSet};

/// Iterative, linear validation: no hierarchy depth limit and no read-triggered repair.
pub(crate) fn validate(records: &[TagRecord]) -> Result<(), TagError> {
    let parents: HashMap<_, _> = records.iter().map(|r| (r.id, r.parent)).collect();
    let mut complete = HashSet::new();
    for record in records {
        let mut path = HashSet::new();
        let mut next = Some(record.id);
        while let Some(id) = next {
            if complete.contains(&id) {
                break;
            }
            if !path.insert(id) {
                return Err(TagError::Corrupt("cyclic Tag hierarchy".into()));
            }
            next = *parents
                .get(&id)
                .ok_or_else(|| TagError::Corrupt("dangling Tag parent".into()))?;
        }
        complete.extend(path);
    }
    Ok(())
}
pub(crate) async fn set_parent(
    c: &mut Context,
    id: TagId,
    parent: Option<TagId>,
) -> Result<(), TagError> {
    sql_query("UPDATE locus_tag_comm_tag SET parent=?, revision=? WHERE id=?")
        .bind::<Nullable<Binary>, _>(parent.map(|id| id.as_bytes().to_vec()))
        .bind::<Text, _>(uuid::Uuid::now_v7().to_string())
        .bind::<Binary, _>(id.as_bytes().as_slice())
        .execute(c.connection())
        .await?;
    Ok(())
}
#[derive(QueryableByName)]
struct IdRow {
    #[diesel(sql_type=Binary)]
    id: Vec<u8>,
}
pub(crate) async fn subtree(c: &mut Context, root: TagId) -> Result<Vec<TagId>, TagError> {
    let forest = persistence::list(c).await?;
    if !forest.iter().any(|r| r.id == root) {
        return Err(TagError::MissingTag);
    }
    // UNION guarantees duplicate-free traversal. Validation above refuses malformed
    // forests instead of accepting the shortened closure of a cycle.
    sql_query("WITH RECURSIVE subtree(id) AS (SELECT id FROM locus_tag_comm_tag WHERE id=? UNION SELECT t.id FROM locus_tag_comm_tag t JOIN subtree s ON t.parent=s.id) SELECT id FROM subtree ORDER BY id")
        .bind::<Binary, _>(root.as_bytes().as_slice()).load::<IdRow>(c.connection()).await?
        .into_iter().map(|r| TagId::from_bytes(&r.id).map_err(TagError::from)).collect()
}
