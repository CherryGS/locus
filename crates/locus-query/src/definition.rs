use crate::error::QueryError;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum FieldType {
    Identifier,
    Text,
    Uint,
    Int,
    Float,
    Time,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Shape {
    Scalar,
    Collection,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    Any,
    All,
    None,
    Missing,
    Empty,
    Present,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct FieldDefinition {
    pub id: String,
    pub owner: String,
    pub field_type: FieldType,
    pub shape: Shape,
    pub unit: Option<String>,
    pub optional: bool,
    pub default_text: bool,
    pub native_value: String,
    pub native_state: String,
    pub native_exact: String,
    pub operations: Vec<Operation>,
    /// Bump when projection meaning or exact normalization changes.
    pub extraction_version: u32,
}
impl FieldDefinition {
    pub fn new(id: &str, owner: &str, field_type: FieldType, shape: Shape) -> Self {
        let mut operations = vec![Operation::Missing, Operation::Present];
        if shape == Shape::Collection {
            operations.extend([
                Operation::Any,
                Operation::All,
                Operation::None,
                Operation::Empty,
            ]);
        } else {
            operations.extend([Operation::Eq, Operation::Ne]);
            match field_type {
                FieldType::Text | FieldType::Identifier => operations.push(Operation::Empty),
                _ => {
                    operations.extend([Operation::Lt, Operation::Le, Operation::Gt, Operation::Ge])
                }
            }
        }
        Self {
            id: id.into(),
            owner: owner.into(),
            field_type,
            shape,
            unit: None,
            optional: true,
            default_text: field_type == FieldType::Text,
            native_value: id.into(),
            native_state: format!("{id}_state"),
            native_exact: if field_type == FieldType::Text {
                format!("{id}_exact")
            } else {
                id.into()
            },
            operations,
            extraction_version: 1,
        }
    }
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct Catalogue {
    pub fields: Vec<FieldDefinition>,
}
impl Catalogue {
    pub fn new(fields: Vec<FieldDefinition>) -> Result<Self, QueryError> {
        let mut names = BTreeMap::new();
        for f in &fields {
            let supported = FieldDefinition::new(&f.id, &f.owner, f.field_type, f.shape).operations;
            if f.operations.iter().any(|op| !supported.contains(op))
                || f.operations
                    .iter()
                    .enumerate()
                    .any(|(i, op)| f.operations[..i].contains(op))
            {
                return Err(QueryError::Invalid(format!(
                    "incompatible capabilities {}",
                    f.id
                )));
            }
            if f.id.is_empty()
                || f.id.starts_with('_')
                || f.owner.is_empty()
                || f.extraction_version == 0
                || f.native_value != f.id
                || f.native_state != format!("{}_state", f.id)
                || f.native_exact
                    != if f.field_type == FieldType::Text {
                        format!("{}_exact", f.id)
                    } else {
                        f.id.clone()
                    }
                || !f.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            {
                return Err(QueryError::Invalid(format!(
                    "invalid field definition {}",
                    f.id
                )));
            }
            for name in [&f.native_value, &f.native_state] {
                if names.insert(name, ()).is_some() {
                    return Err(QueryError::Invalid(format!("duplicate field {name}")));
                }
            }
            if f.native_exact != f.native_value && names.insert(&f.native_exact, ()).is_some() {
                return Err(QueryError::Invalid("exact reference collision".into()));
            }
            if f.default_text && f.field_type != FieldType::Text {
                return Err(QueryError::Invalid(format!("default text type {}", f.id)));
            }
        }
        Ok(Self { fields })
    }
    pub fn field(&self, id: &str) -> Result<&FieldDefinition, QueryError> {
        self.fields
            .iter()
            .find(|f| f.id == id)
            .ok_or_else(|| QueryError::Invalid(format!("unknown field {id}")))
    }
}
