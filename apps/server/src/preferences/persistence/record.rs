use diesel::{
    OptionalExtension, QueryableByName, sql_query,
    sql_types::{BigInt, Binary, Text},
};
use diesel_async::RunQueryDsl;
use locus_core::api::EntityId;
use locus_store::api::Context;

use super::super::{
    error::PreferenceError,
    identity::{SavedRevision, ViewDefinitionId},
    record::SavedPreference,
};

#[derive(QueryableByName)]
struct Row {
    #[diesel(sql_type = Text)]
    view_definition_id: String,
    #[diesel(sql_type = BigInt)]
    revision: i64,
    #[diesel(sql_type = Text)]
    definition_type: String,
    #[diesel(sql_type = Text)]
    revision_type: String,
}

pub(in crate::preferences) async fn read(
    context: &mut Context,
    entity: EntityId,
) -> Result<Option<SavedPreference>, PreferenceError> {
    let row = sql_query(
        "SELECT view_definition_id, revision, typeof(view_definition_id) AS definition_type,
        typeof(revision) AS revision_type FROM locus_entity_view_preferences WHERE entity_id = ?",
    )
    .bind::<Binary, _>(entity.as_bytes().as_slice())
    .get_result::<Row>(context.connection())
    .await
    .optional()?;
    row.map(|row| {
        let corrupt = |message: String| PreferenceError::CorruptRecord { entity, message };
        if row.definition_type != "text" || row.revision_type != "integer" {
            return Err(corrupt("invalid stored value types".into()));
        }
        Ok(SavedPreference {
            entity,
            view_definition: ViewDefinitionId::new(row.view_definition_id)
                .map_err(|error| corrupt(error.to_string()))?,
            revision: SavedRevision::new(row.revision)
                .map_err(|error| corrupt(error.to_string()))?,
        })
    })
    .transpose()
}

pub(in crate::preferences) async fn write(
    context: &mut Context,
    value: &SavedPreference,
) -> Result<(), PreferenceError> {
    sql_query("INSERT INTO locus_entity_view_preferences (entity_id, view_definition_id, revision) VALUES (?, ?, ?)
        ON CONFLICT(entity_id) DO UPDATE SET view_definition_id = excluded.view_definition_id, revision = excluded.revision")
        .bind::<Binary, _>(value.entity.as_bytes().as_slice())
        .bind::<Text, _>(value.view_definition.as_str())
        .bind::<BigInt, _>(value.revision.value())
        .execute(context.connection()).await?;
    Ok(())
}
