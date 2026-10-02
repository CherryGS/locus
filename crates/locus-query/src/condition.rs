use crate::{
    definition::{Catalogue, FieldType, Operation},
    error::QueryError,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Decimal strings preserve the full integer range across JSON consumers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum Value {
    Identifier(String),
    Text(String),
    Uint(String),
    Int(String),
    Float(f64),
    Time(String),
}
impl Value {
    pub fn validate(&self, kind: FieldType) -> Result<(), QueryError> {
        let valid = match (self, kind) {
            (Self::Identifier(_), FieldType::Identifier) | (Self::Text(_), FieldType::Text) => true,
            (Self::Uint(v), FieldType::Uint) => v.parse::<u64>().is_ok_and(|n| n.to_string() == *v),
            (Self::Int(v), FieldType::Int) | (Self::Time(v), FieldType::Time) => {
                v.parse::<i64>().is_ok_and(|n| n.to_string() == *v)
            }
            (Self::Float(v), FieldType::Float) => v.is_finite(),
            _ => false,
        };
        if valid {
            Ok(())
        } else {
            Err(QueryError::Invalid("value type or precision".into()))
        }
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct Predicate {
    pub field: String,
    pub operation: Operation,
    #[serde(default)]
    pub values: Vec<Value>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum Condition {
    And(Vec<Condition>),
    Or(Vec<Condition>),
    Not(Box<Condition>),
    Predicate(Predicate),
    Reference(crate::reference::ReferenceOperand),
}
impl Condition {
    pub fn validate(&self, catalogue: &Catalogue) -> Result<(), QueryError> {
        match self {
            Self::Reference(operand) => operand.validate(catalogue)?,
            Self::And(children) | Self::Or(children) => {
                if children.is_empty() {
                    return Err(QueryError::Invalid("empty Boolean group".into()));
                }
                for child in children {
                    child.validate(catalogue)?;
                }
            }
            Self::Not(child) => child.validate(catalogue)?,
            Self::Predicate(p) => {
                let field = catalogue.field(&p.field)?;
                if !field.operations.contains(&p.operation) {
                    return Err(QueryError::Invalid(format!(
                        "unsupported operation on {}",
                        p.field
                    )));
                }
                let valid = match p.operation {
                    Operation::Missing | Operation::Empty | Operation::Present => {
                        p.values.is_empty()
                    }
                    Operation::Any | Operation::All | Operation::None => !p.values.is_empty(),
                    _ => p.values.len() == 1,
                };
                if !valid {
                    return Err(QueryError::Invalid("operand count".into()));
                }
                for value in &p.values {
                    value.validate(field.field_type)?;
                }
            }
        }
        Ok(())
    }
}
