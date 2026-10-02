use crate::{
    definition::{Catalogue, FieldType, Shape},
    error::QueryError,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{future::Future, pin::Pin};

/// Query parameters have no per-Entity projection or indexed presence semantics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReferenceMeaning {
    InclusiveSubtree,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ReferenceDefinition {
    pub id: String,
    pub owner: String,
    pub target_field: String,
    pub meaning: ReferenceMeaning,
}
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema)]
pub struct ReferenceOperand {
    pub reference: String,
    pub identity: String,
}
impl ReferenceOperand {
    pub fn normalized(&self) -> Result<Self, QueryError> {
        let identity = uuid::Uuid::parse_str(&self.identity)
            .map_err(|_| {
                QueryError::Invalid(format!("{} requires one UUID identity", self.reference))
            })?
            .to_string();
        Ok(Self {
            reference: self.reference.clone(),
            identity,
        })
    }
    pub fn validate(&self, catalogue: &Catalogue) -> Result<(), QueryError> {
        catalogue.reference(&self.reference)?;
        uuid::Uuid::parse_str(&self.identity).map_err(|_| {
            QueryError::Invalid(format!("{} requires one UUID identity", self.reference))
        })?;
        Ok(())
    }
}
impl ReferenceDefinition {
    pub(crate) fn validate(&self, catalogue: &Catalogue) -> Result<(), QueryError> {
        let field = catalogue.field(&self.target_field)?;
        if self.id.is_empty()
            || self.id.starts_with('_')
            || !self
                .id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_')
            || self.owner != field.owner
            || field.field_type != FieldType::Identifier
            || field.shape != Shape::Collection
        {
            return Err(QueryError::Invalid(format!(
                "invalid query reference {}",
                self.id
            )));
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ReferenceChoice {
    pub identity: String,
    pub name: String,
}
pub type ReferenceFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Vec<String>, QueryError>> + Send + 'a>>;
pub type ReferenceChoicesFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Vec<ReferenceChoice>, QueryError>> + Send + 'a>>;
