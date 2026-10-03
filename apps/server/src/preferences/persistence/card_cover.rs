use diesel::{
    OptionalExtension, QueryableByName, sql_query,
    sql_types::{BigInt, Binary, Nullable, Text},
};
use diesel_async::RunQueryDsl;
use locus_core::api::{ComponentId, EntityId};
use locus_store::api::Context;

use super::super::{
    error::PreferenceError,
    identity::{CivitaiVersionId, SavedRevision},
    record::{CardCoverSelection, SavedCardCover},
};

#[derive(QueryableByName)]
struct Row {
    #[diesel(sql_type = Nullable<Binary>)]
    source_component_id: Option<Vec<u8>>,
    #[diesel(sql_type = Nullable<Text>)]
    version_id: Option<String>,
    #[diesel(sql_type = Nullable<Binary>)]
    target_entity_id: Option<Vec<u8>>,
    #[diesel(sql_type = Nullable<Binary>)]
    target_file_id: Option<Vec<u8>>,
    #[diesel(sql_type = Nullable<Binary>)]
    image_component_id: Option<Vec<u8>>,
    #[diesel(sql_type = BigInt)]
    revision: i64,
    #[diesel(sql_type = Text)]
    revision_type: String,
}

pub(in crate::preferences) async fn read(
    context: &mut Context,
    entity: EntityId,
) -> Result<Option<SavedCardCover>, PreferenceError> {
    let row = sql_query("SELECT source_component_id, version_id, target_entity_id, target_file_id, image_component_id, revision, typeof(revision) AS revision_type FROM locus_server_comm_entity_card_cover_preference WHERE entity_id = ?")
        .bind::<Binary, _>(entity.as_bytes().as_slice()).get_result::<Row>(context.connection()).await.optional()?;
    row.map(|row| {
        let corrupt = |message: String| PreferenceError::CorruptRecord { entity, message };
        if row.revision_type != "integer" {
            return Err(corrupt("invalid stored revision type".into()));
        }
        let cover = match (
            row.source_component_id,
            row.version_id,
            row.target_entity_id,
            row.target_file_id,
            row.image_component_id,
        ) {
            (None, None, None, None, None) => None,
            (Some(source), Some(version), Some(target), Some(file), Some(image)) => {
                Some(CardCoverSelection {
                    source: ComponentId::from_bytes(&source).map_err(|e| corrupt(e.to_string()))?,
                    version: CivitaiVersionId::new(version).map_err(|e| corrupt(e.to_string()))?,
                    target: EntityId::from_bytes(&target).map_err(|e| corrupt(e.to_string()))?,
                    file: ComponentId::from_bytes(&file).map_err(|e| corrupt(e.to_string()))?,
                    image: ComponentId::from_bytes(&image).map_err(|e| corrupt(e.to_string()))?,
                })
            }
            _ => return Err(corrupt("incomplete stored cover selection".into())),
        };
        Ok(SavedCardCover {
            entity,
            cover,
            revision: SavedRevision::new(row.revision).map_err(|e| corrupt(e.to_string()))?,
        })
    })
    .transpose()
}

pub(in crate::preferences) async fn write(
    context: &mut Context,
    value: &SavedCardCover,
) -> Result<(), PreferenceError> {
    let cover = value.cover.as_ref();
    sql_query("INSERT INTO locus_server_comm_entity_card_cover_preference (entity_id, source_component_id, version_id, target_entity_id, target_file_id, image_component_id, revision) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(entity_id) DO UPDATE SET source_component_id=excluded.source_component_id, version_id=excluded.version_id, target_entity_id=excluded.target_entity_id, target_file_id=excluded.target_file_id, image_component_id=excluded.image_component_id, revision=excluded.revision")
        .bind::<Binary, _>(value.entity.as_bytes().as_slice())
        .bind::<Nullable<Binary>, _>(cover.map(|c| c.source.as_bytes().to_vec()))
        .bind::<Nullable<Text>, _>(cover.map(|c| c.version.as_str()))
        .bind::<Nullable<Binary>, _>(cover.map(|c| c.target.as_bytes().to_vec()))
        .bind::<Nullable<Binary>, _>(cover.map(|c| c.file.as_bytes().to_vec()))
        .bind::<Nullable<Binary>, _>(cover.map(|c| c.image.as_bytes().to_vec()))
        .bind::<BigInt, _>(value.revision.value())
        .execute(context.connection()).await?;
    Ok(())
}
