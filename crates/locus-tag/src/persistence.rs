use crate::{error::TagError, identity::TagId, record::TagRecord};
use diesel::{
    OptionalExtension, QueryableByName, sql_query,
    sql_types::{Binary, Text},
};
use diesel_async::RunQueryDsl;
use locus_core::api::ComponentId;
use locus_store::api::Context;
#[derive(QueryableByName)]
struct Row {
    #[diesel(sql_type=Binary)]
    id: Vec<u8>,
    #[diesel(sql_type=Text)]
    name: String,
    #[diesel(sql_type=Text)]
    revision: String,
}
impl Row {
    fn record(self) -> Result<TagRecord, TagError> {
        if self.name.trim() != self.name
            || self.name.is_empty()
            || uuid::Uuid::parse_str(&self.revision).is_err()
        {
            return Err(TagError::Corrupt("malformed vocabulary record".into()));
        }
        Ok(TagRecord {
            id: TagId::from_bytes(&self.id)?,
            name: self.name,
            revision: self.revision,
        })
    }
}
pub(crate) async fn list(c: &mut Context) -> Result<Vec<TagRecord>, TagError> {
    sql_query("SELECT id,name,revision FROM locus_tag_comm_tag ORDER BY name COLLATE BINARY,id")
        .load::<Row>(c.connection())
        .await?
        .into_iter()
        .map(Row::record)
        .collect()
}
pub(crate) async fn read(c: &mut Context, id: TagId) -> Result<TagRecord, TagError> {
    sql_query("SELECT id,name,revision FROM locus_tag_comm_tag WHERE id=?")
        .bind::<Binary, _>(id.as_bytes().as_slice())
        .get_result::<Row>(c.connection())
        .await
        .optional()?
        .ok_or(TagError::MissingTag)?
        .record()
}
pub(crate) async fn available(
    c: &mut Context,
    name: &str,
    except: Option<TagId>,
) -> Result<(), TagError> {
    let row =
        sql_query("SELECT id,name,revision FROM locus_tag_comm_tag WHERE name=? COLLATE BINARY")
            .bind::<Text, _>(name)
            .get_result::<Row>(c.connection())
            .await
            .optional()?;
    if let Some(row) = row
        && Some(row.record()?.id) != except
    {
        return Err(TagError::DuplicateName);
    }
    Ok(())
}
#[derive(QueryableByName)]
struct IdRow {
    #[diesel(sql_type=Binary)]
    id: Vec<u8>,
}
pub(crate) async fn set(c: &mut Context, id: ComponentId) -> Result<Vec<TagRecord>, TagError> {
    let found = sql_query("SELECT id FROM locus_tag_comp_set WHERE id=?")
        .bind::<Binary, _>(id.as_bytes().as_slice())
        .get_result::<IdRow>(c.connection())
        .await
        .optional()?
        .ok_or(TagError::MissingSet)?;
    ComponentId::from_bytes(&found.id)?;
    // Resolve every retained reference explicitly: an orphan is an integrity error, never an empty projection.
    let refs =
        sql_query("SELECT tag AS id FROM locus_tag_rela_assignment WHERE tag_set=? ORDER BY tag")
            .bind::<Binary, _>(id.as_bytes().as_slice())
            .load::<IdRow>(c.connection())
            .await?;
    let mut records = Vec::new();
    for row in refs {
        records.push(
            read(c, TagId::from_bytes(&row.id)?)
                .await
                .map_err(|e| match e {
                    TagError::MissingTag | TagError::Identity(_) => {
                        TagError::Corrupt(e.to_string())
                    }
                    other => other,
                })?,
        );
    }
    records.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(records)
}
pub(crate) async fn delete_set(
    c: &mut Context,
    id: ComponentId,
) -> Result<(), diesel::result::Error> {
    sql_query("DELETE FROM locus_tag_comp_set WHERE id=?")
        .bind::<Binary, _>(id.as_bytes().as_slice())
        .execute(c.connection())
        .await?;
    Ok(())
}
