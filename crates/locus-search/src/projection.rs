use crate::error::SearchError;
use locus_core::api::{EntityId, Kernel, KindId};
use locus_query::api::{
    Catalogue, FieldDefinition, FieldType, FieldValue, Provider, Shape, Value, ValueState,
};
use locus_store::api::Context;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
#[derive(Clone)]
pub(crate) struct Providers {
    pub catalogue: Catalogue,
    pub owners: BTreeMap<KindId, Arc<dyn Provider>>,
}
impl Providers {
    pub fn new(providers: Vec<Arc<dyn Provider>>) -> Result<Self, SearchError> {
        let mut definitions = vec![
            FieldDefinition::new("entity_id", "core", FieldType::Identifier, Shape::Scalar),
            FieldDefinition::new(
                "entity_kinds",
                "core",
                FieldType::Identifier,
                Shape::Collection,
            ),
        ];
        let mut owners = BTreeMap::new();
        for provider in providers {
            definitions.extend(provider.definitions());
            if owners.insert(provider.kind(), provider).is_some() {
                return Err(SearchError::Invalid("duplicate provider kind".into()));
            }
        }
        Ok(Self {
            catalogue: Catalogue::new(definitions)?,
            owners,
        })
    }
    pub async fn project(
        &self,
        c: &mut Context,
        kernel: &Kernel,
        ids: &[EntityId],
    ) -> Result<Vec<(EntityId, Option<Vec<FieldValue>>)>, SearchError> {
        let observations = kernel.memberships_batch_in(c, ids).await?;
        let mut result = Vec::with_capacity(ids.len());
        for observed in observations {
            let Some(memberships) = observed.memberships else {
                result.push((observed.entity, None));
                continue;
            };
            let mut values = vec![
                FieldValue {
                    field: "entity_id".into(),
                    component: None,
                    value: ValueState::Values(vec![Value::Identifier(observed.entity.to_string())]),
                },
                FieldValue {
                    field: "entity_kinds".into(),
                    component: None,
                    value: if memberships.is_empty() {
                        ValueState::Empty
                    } else {
                        ValueState::Values(
                            memberships
                                .iter()
                                .map(|m| Value::Identifier(m.kind.to_string()))
                                .collect(),
                        )
                    },
                },
            ];
            let mut supplied: BTreeSet<String> = values.iter().map(|v| v.field.clone()).collect();
            for membership in memberships {
                if let Some(provider) = self.owners.get(&membership.kind) {
                    let declarations = provider.definitions();
                    let attribution = format!(
                        "Entity {} Kind {} Component {}",
                        observed.entity, membership.kind, membership.component
                    );
                    let projected =
                        provider
                            .project(c, membership.component)
                            .await
                            .map_err(|error| {
                                locus_query::api::QueryError::Projection(format!(
                                    "{attribution}: {error}"
                                ))
                            })?;
                    if projected.len() != declarations.len() {
                        return Err(SearchError::Invalid(
                            "incomplete provider projection".into(),
                        ));
                    }
                    for value in projected {
                        let definition = declarations
                            .iter()
                            .find(|d| d.id == value.field)
                            .ok_or_else(|| SearchError::Invalid("foreign provider field".into()))?;
                        if value.component.as_deref()
                            != Some(membership.component.to_string().as_str())
                            || !supplied.insert(value.field.clone())
                        {
                            return Err(SearchError::Invalid(
                                "projection provenance or duplicate field".into(),
                            ));
                        }
                        value.validate(definition).map_err(|error| {
                            locus_query::api::QueryError::Projection(format!(
                                "{attribution} Field {}: {error}",
                                value.field
                            ))
                        })?;
                        values.push(value);
                    }
                }
            }
            for definition in &self.catalogue.fields {
                if !supplied.contains(&definition.id) {
                    values.push(FieldValue {
                        field: definition.id.clone(),
                        component: None,
                        value: ValueState::Missing,
                    });
                }
            }
            result.push((observed.entity, Some(values)));
        }
        Ok(result)
    }
}
