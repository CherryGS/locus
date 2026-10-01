use crate::{error::SearchError, original, schema::Mapping, service::Publication};
use locus_query::api::{Assistance, FieldType, Value};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeSet, HashMap},
    sync::{Arc, Mutex},
    time::Instant,
};
use tantivy::{DocAddress, Searcher, TantivyDocument, schema::OwnedValue};

/// caseless 0.2.2 pins Unicode 16.0.0 default full folding, without normalization.
pub const MATCHING_POLICY: &str = "unicode-16.0.0-default-full-fold-no-normalization-v1";
pub(crate) const LIFETIME_SECONDS: u64 = 600;
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Observation {
    pub context: String,
    pub generation: String,
    pub covered_sequence: String,
    pub expires_after_seconds: u64,
    pub matching_policy: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct StringPageRequest {
    pub context: String,
    pub field: String,
    #[serde(default)]
    pub fragment: String,
    pub continuation: Option<String>,
    pub limit: Option<usize>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct StringPage {
    pub values: Vec<String>,
    pub continuation: Option<String>,
    /// The field has no original values, distinct from no fragment matches.
    pub no_values: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct BoundsRequest {
    pub context: String,
    pub field: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Bounds {
    pub minimum: Option<Value>,
    pub maximum: Option<Value>,
}
#[derive(Debug)]
pub(crate) enum Observed {
    Strings(Vec<(String, String)>),
    Bounds(Bounds),
}
pub(crate) struct DiscoveryContext {
    pub searcher: Searcher,
    pub _publication: Publication,
    pub expires: Instant,
    pub fields: Mutex<HashMap<String, Arc<Observed>>>,
    pub cursors: Mutex<HashMap<String, Cursor>>,
}
pub(crate) struct Cursor {
    pub field: String,
    pub fragment: String,
    pub offset: usize,
}

fn typed(value: OwnedValue, kind: FieldType) -> Result<Value, SearchError> {
    let error = || SearchError::Invalid("stored logical type or precision".into());
    let v = match (kind, value) {
        (FieldType::Text, OwnedValue::Str(v)) => Value::Text(v),
        (FieldType::Identifier, OwnedValue::Str(v)) => Value::Identifier(v),
        (FieldType::Uint, OwnedValue::U64(v)) => Value::Uint(v.to_string()),
        (FieldType::Uint, OwnedValue::I64(v)) => {
            Value::Uint(u64::try_from(v).map_err(|_| error())?.to_string())
        }
        (FieldType::Int, OwnedValue::I64(v)) => Value::Int(v.to_string()),
        (FieldType::Int, OwnedValue::U64(v)) => {
            Value::Int(i64::try_from(v).map_err(|_| error())?.to_string())
        }
        (FieldType::Time, OwnedValue::I64(v)) => Value::Time(v.to_string()),
        (FieldType::Time, OwnedValue::U64(v)) => {
            Value::Time(i64::try_from(v).map_err(|_| error())?.to_string())
        }
        (FieldType::Float, OwnedValue::F64(v)) => Value::Float(v),
        _ => return Err(error()),
    };
    v.validate(kind)?;
    Ok(v)
}
fn compare(a: &Value, b: &Value) -> std::cmp::Ordering {
    match (a, b) {
        (Value::Uint(a), Value::Uint(b)) => a
            .parse::<u64>()
            .unwrap_or_default()
            .cmp(&b.parse().unwrap_or_default()),
        (Value::Int(a), Value::Int(b)) | (Value::Time(a), Value::Time(b)) => a
            .parse::<i64>()
            .unwrap_or_default()
            .cmp(&b.parse().unwrap_or_default()),
        (Value::Float(a), Value::Float(b)) => a.total_cmp(b),
        _ => std::cmp::Ordering::Equal,
    }
}
impl DiscoveryContext {
    fn observe(&self, mapping: &Mapping, field: &str) -> Result<Arc<Observed>, SearchError> {
        if let Some(cached) = self
            .fields
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(field)
            .cloned()
        {
            return Ok(cached);
        }
        let definition = mapping.catalogue.field(field)?;
        if definition.assistance == Assistance::Manual {
            return Err(SearchError::Request(
                "field provides source guidance only".into(),
            ));
        }
        let mut originals = BTreeSet::new();
        let mut bounds = Bounds {
            minimum: None,
            maximum: None,
        };
        // No database exclusion is held here. Stored values and live document IDs
        // come from this pinned Searcher; dictionaries cannot certify originals.
        for (segment, reader) in self.searcher.segment_readers().iter().enumerate() {
            for doc in reader.doc_ids_alive() {
                if self.expires <= Instant::now() {
                    return Err(SearchError::ContextUnavailable);
                }
                let doc: TantivyDocument =
                    self.searcher.doc(DocAddress::new(segment as u32, doc))?;
                for value in original::values(&doc, mapping.values, field)? {
                    let value = typed(value, definition.field_type)?;
                    match value {
                        Value::Text(s) | Value::Identifier(s) => {
                            originals.insert(s);
                        }
                        v => {
                            if bounds
                                .minimum
                                .as_ref()
                                .is_none_or(|min| compare(&v, min).is_lt())
                            {
                                bounds.minimum = Some(v.clone());
                            }
                            if bounds
                                .maximum
                                .as_ref()
                                .is_none_or(|max| compare(&v, max).is_gt())
                            {
                                bounds.maximum = Some(v);
                            }
                        }
                    }
                }
            }
        }
        let observed = Arc::new(if definition.assistance == Assistance::Strings {
            let mut values: Vec<_> = originals
                .into_iter()
                .map(|s| (caseless::default_case_fold_str(&s), s))
                .collect();
            values.sort_unstable();
            Observed::Strings(values)
        } else {
            Observed::Bounds(bounds)
        });
        if self.expires <= Instant::now() {
            return Err(SearchError::ContextUnavailable);
        }
        Ok(self
            .fields
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entry(field.into())
            .or_insert(observed)
            .clone())
    }
    pub(crate) fn strings(
        &self,
        mapping: &Mapping,
        request: StringPageRequest,
    ) -> Result<StringPage, SearchError> {
        let limit = request.limit.unwrap_or(40);
        if !(1..=128).contains(&limit) {
            return Err(SearchError::Request("page limit must be 1..128".into()));
        }
        if mapping.catalogue.field(&request.field)?.assistance != Assistance::Strings {
            return Err(SearchError::Request(
                "field has no string observation capability".into(),
            ));
        }
        let offset = if let Some(token) = request.continuation {
            let cursors = self.cursors.lock().unwrap_or_else(|e| e.into_inner());
            let cursor = cursors
                .get(&token)
                .ok_or_else(|| SearchError::Request("foreign or invalid continuation".into()))?;
            if cursor.field != request.field || cursor.fragment != request.fragment {
                return Err(SearchError::Request(
                    "continuation field/fragment mismatch".into(),
                ));
            }
            cursor.offset
        } else {
            0
        };
        let observed = self.observe(mapping, &request.field)?;
        let Observed::Strings(originals) = &*observed else {
            return Err(SearchError::Invalid("observation kind".into()));
        };
        let fragment = caseless::default_case_fold_str(&request.fragment);
        let exact = originals.iter().find(|(_, s)| s == &request.fragment);
        let ordered = exact.into_iter().chain(
            originals
                .iter()
                .filter(|(f, s)| s != &request.fragment && f.contains(&fragment)),
        );
        let mut matched = ordered.skip(offset).peekable();
        let mut values = Vec::new();
        let mut bytes = 0;
        while values.len() < limit {
            let Some((_, s)) = matched.peek() else {
                break;
            };
            // Bound ordinary page bytes; a single arbitrarily long original must
            // still be transferable intact, so it may occupy a page by itself.
            if !values.is_empty() && bytes + s.len() > 1_048_576 {
                break;
            }
            bytes += s.len();
            values.push(s.clone());
            matched.next();
        }
        let continuation = if matched.peek().is_some() {
            let token = uuid::Uuid::now_v7().to_string();
            self.cursors
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(
                    token.clone(),
                    Cursor {
                        field: request.field,
                        fragment: request.fragment,
                        offset: offset + values.len(),
                    },
                );
            Some(token)
        } else {
            None
        };
        Ok(StringPage {
            values,
            continuation,
            no_values: originals.is_empty(),
        })
    }
    pub(crate) fn bounds(&self, mapping: &Mapping, field: &str) -> Result<Bounds, SearchError> {
        if mapping.catalogue.field(field)?.assistance != Assistance::Bounds {
            return Err(SearchError::Request(
                "field has no bounds capability".into(),
            ));
        }
        match &*self.observe(mapping, field)? {
            Observed::Bounds(bounds) => Ok(bounds.clone()),
            _ => Err(SearchError::Invalid("observation kind".into())),
        }
    }
}
