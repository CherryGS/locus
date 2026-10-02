use crate::{identity::TAG_SET_KIND, service::TagService};
use locus_core::api::{ComponentId, KindId};
use locus_query::api::*;
use locus_store::api::Context;
pub struct TagQueryProvider;
impl Provider for TagQueryProvider {
    fn references(&self) -> Vec<ReferenceDefinition> {
        vec![ReferenceDefinition {
            id: "tag_subtree".into(),
            owner: "tag".into(),
            target_field: "tag_ids".into(),
            meaning: ReferenceMeaning::InclusiveSubtree,
        }]
    }
    fn resolve_reference<'a>(
        &'a self,
        c: &'a mut Context,
        operand: &'a ReferenceOperand,
    ) -> ReferenceFuture<'a> {
        Box::pin(async move {
            if operand.reference != "tag_subtree" {
                return Err(QueryError::Invalid("unknown Tag reference".into()));
            }
            let id = uuid::Uuid::parse_str(&operand.identity)
                .map_err(|e| QueryError::Invalid(e.to_string()))?;
            let id = crate::identity::TagId::from_bytes(id.as_bytes())
                .map_err(|e| QueryError::Invalid(e.to_string()))?;
            TagService::subtree_in(c, id)
                .await
                .map(|ids| ids.into_iter().map(|id| id.to_string()).collect())
                .map_err(|e| QueryError::Invalid(format!("tag_subtree {}: {e}", operand.identity)))
        })
    }
    fn reference_choices<'a>(
        &'a self,
        c: &'a mut Context,
        reference: &'a str,
    ) -> ReferenceChoicesFuture<'a> {
        Box::pin(async move {
            if reference != "tag_subtree" {
                return Err(QueryError::Invalid("unknown Tag reference".into()));
            }
            TagService::list_in(c)
                .await
                .map(|records| {
                    records
                        .into_iter()
                        .map(|r| ReferenceChoice {
                            identity: r.id.to_string(),
                            name: r.name,
                        })
                        .collect()
                })
                .map_err(|e| QueryError::Invalid(e.to_string()))
        })
    }
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
