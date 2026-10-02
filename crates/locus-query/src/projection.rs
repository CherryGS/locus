use crate::{
    condition::Value,
    definition::{FieldDefinition, Shape},
    error::QueryError,
};
use locus_core::api::{ComponentId, KindId};
use locus_store::api::Context;
use serde::{Deserialize, Serialize};
use std::{future::Future, pin::Pin};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", content = "values", rename_all = "snake_case")]
pub enum ValueState {
    Missing,
    Empty,
    Values(Vec<Value>),
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldValue {
    pub field: String,
    pub component: Option<String>,
    pub value: ValueState,
}
impl FieldValue {
    pub fn scalar(field: impl Into<String>, component: ComponentId, value: Option<Value>) -> Self {
        let value = match value {
            None => ValueState::Missing,
            Some(Value::Text(v) | Value::Identifier(v)) if v.is_empty() => ValueState::Empty,
            Some(value) => ValueState::Values(vec![value]),
        };
        Self {
            field: field.into(),
            component: Some(component.to_string()),
            value,
        }
    }
    pub fn collection(
        field: impl Into<String>,
        component: ComponentId,
        values: Option<Vec<Value>>,
    ) -> Self {
        Self {
            field: field.into(),
            component: Some(component.to_string()),
            value: match values {
                None => ValueState::Missing,
                Some(values) if values.is_empty() => ValueState::Empty,
                Some(values) => ValueState::Values(values),
            },
        }
    }
    pub fn validate(&self, definition: &FieldDefinition) -> Result<(), QueryError> {
        if self.field != definition.id {
            return Err(QueryError::Projection(
                "field identity does not match definition".into(),
            ));
        }
        match &self.value {
            ValueState::Missing if !definition.optional => {
                return Err(QueryError::Projection(format!(
                    "required field {} missing",
                    definition.id
                )));
            }
            ValueState::Empty
                if !definition
                    .operations
                    .contains(&crate::definition::Operation::Empty) =>
            {
                return Err(QueryError::Projection(format!(
                    "invalid empty {}",
                    definition.id
                )));
            }
            ValueState::Values(values) => {
                if values.is_empty() || definition.shape == Shape::Scalar && values.len() != 1 {
                    return Err(QueryError::Projection("value shape".into()));
                }
                for v in values {
                    v.validate(definition.field_type)?;
                    if definition.shape == Shape::Scalar
                        && matches!(v,Value::Text(v)|Value::Identifier(v) if v.is_empty())
                    {
                        return Err(QueryError::Projection(
                            "empty scalar must use Empty state".into(),
                        ));
                    }
                }
            }
            _ => (),
        }
        Ok(())
    }
}
pub type ProjectionFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Vec<FieldValue>, QueryError>> + Send + 'a>>;
pub trait Provider: Send + Sync {
    fn kind(&self) -> KindId;
    fn definitions(&self) -> Vec<FieldDefinition>;
    fn references(&self) -> Vec<crate::reference::ReferenceDefinition> {
        Vec::new()
    }
    fn resolve_reference<'a>(
        &'a self,
        _context: &'a mut Context,
        operand: &'a crate::reference::ReferenceOperand,
    ) -> crate::reference::ReferenceFuture<'a> {
        Box::pin(async move {
            Err(QueryError::Invalid(format!(
                "unsupported query reference {}",
                operand.reference
            )))
        })
    }
    fn reference_choices<'a>(
        &'a self,
        _context: &'a mut Context,
        reference: &'a str,
    ) -> crate::reference::ReferenceChoicesFuture<'a> {
        Box::pin(async move {
            Err(QueryError::Invalid(format!(
                "unsupported query reference {reference}"
            )))
        })
    }
    fn project<'a>(
        &'a self,
        context: &'a mut Context,
        component: ComponentId,
    ) -> ProjectionFuture<'a>;
}
