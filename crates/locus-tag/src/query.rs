use crate::{identity::TAG_SET_KIND, service::TagService};
use locus_core::api::{ComponentId, KindId};
use locus_query::api::*;
use locus_store::api::Context;
pub struct TagQueryProvider;
impl Provider for TagQueryProvider {
    fn kind(&self) -> KindId {
        TAG_SET_KIND
    }
    fn definitions(&self) -> Vec<FieldDefinition> {
        vec![
            FieldDefinition::new("tag_ids", "tag", FieldType::Identifier, Shape::Collection),
            {
                let mut f =
                    FieldDefinition::new("tag_names", "tag", FieldType::Text, Shape::Collection);
                f.assistance = Assistance::Strings;
                f
            },
        ]
    }
    fn project<'a>(&'a self, c: &'a mut Context, id: ComponentId) -> ProjectionFuture<'a> {
        Box::pin(async move {
            let set = TagService::read_set_in(c, id)
                .await
                .map_err(|e| QueryError::Projection(e.to_string()))?;
            Ok(vec![
                FieldValue::collection(
                    "tag_ids",
                    id,
                    Some(
                        set.tags
                            .iter()
                            .map(|t| Value::Identifier(t.id.to_string()))
                            .collect(),
                    ),
                ),
                FieldValue::collection(
                    "tag_names",
                    id,
                    Some(set.tags.into_iter().map(|t| Value::Text(t.name)).collect()),
                ),
            ])
        })
    }
}
