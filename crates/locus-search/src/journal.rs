use crate::error::SearchError;
use diesel::{
    QueryableByName, sql_query,
    sql_types::{BigInt, Binary, Text},
};
use diesel_async::RunQueryDsl;
use locus_core::api::EntityId;
use locus_store::api::Context;
#[derive(QueryableByName)]
pub(crate) struct Boundary {
    #[diesel(sql_type=Text)]
    pub identity: String,
    #[diesel(sql_type=BigInt)]
    pub head: i64,
}
#[derive(QueryableByName)]
struct Row {
    #[diesel(sql_type=BigInt)]
    sequence: i64,
    #[diesel(sql_type=Binary)]
    entity: Vec<u8>,
}
pub(crate) async fn boundary(c: &mut Context) -> Result<Boundary, SearchError> {
    Ok(
        sql_query("SELECT identity,head FROM locus_search_comm_journal_identity WHERE singleton=1")
            .get_result(c.connection())
            .await?,
    )
}
pub(crate) async fn pending(
    c: &mut Context,
    after: i64,
) -> Result<(i64, Vec<EntityId>), SearchError> {
    let rows=sql_query("SELECT sequence,entity FROM locus_search_comm_invalidation WHERE sequence>? ORDER BY sequence LIMIT 2048").bind::<BigInt,_>(after).load::<Row>(c.connection()).await?;
    let covered = rows.last().map(|r| r.sequence).unwrap_or(after);
    let mut ids = std::collections::BTreeSet::new();
    for row in rows {
        ids.insert(
            EntityId::from_bytes(&row.entity).map_err(|e| SearchError::Invalid(e.to_string()))?,
        );
    }
    Ok((covered, ids.into_iter().collect()))
}
pub(crate) async fn acknowledge(c: &mut Context, sequence: i64) -> Result<(), SearchError> {
    // Retain replay history. Head never derives from a potentially pruned MAX(seq).
    sql_query("UPDATE locus_search_comm_journal_identity SET acknowledged=MAX(acknowledged,?) WHERE singleton=1").bind::<BigInt,_>(sequence).execute(c.connection()).await?;
    Ok(())
}
