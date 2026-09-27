use crate::error::SearchError;
use locus_query::api::{Catalogue, FieldType, FieldValue, Value, ValueState};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use tantivy::{Index, TantivyDocument, schema::*};

#[derive(Clone)]
pub(crate) struct Mapping {
    pub schema: Schema,
    pub id: Field,
    pub hi: Field,
    pub lo: Field,
    pub evidence: Field,
    pub fields: BTreeMap<String, (Field, Field, Field)>,
    pub defaults: Vec<Field>,
    pub fingerprint: String,
}
impl Mapping {
    pub fn new(catalogue: &Catalogue) -> Result<Self, SearchError> {
        let mut schema = Schema::builder();
        let id = schema.add_text_field("_entity", STRING);
        let hi = schema.add_u64_field("_id_hi", FAST);
        let lo = schema.add_u64_field("_id_lo", FAST);
        let evidence = schema.add_bytes_field("_evidence", STORED);
        let mut fields = BTreeMap::new();
        let mut defaults = Vec::new();
        for f in &catalogue.fields {
            let value = match f.field_type {
                FieldType::Identifier => schema.add_text_field(&f.id, STRING | FAST),
                FieldType::Text => schema.add_text_field(
                    &f.id,
                    TextOptions::default()
                        .set_indexing_options(
                            TextFieldIndexing::default()
                                .set_tokenizer("locus_hybrid_v1")
                                .set_index_option(IndexRecordOption::WithFreqsAndPositions),
                        )
                        .set_fast(None),
                ),
                FieldType::Uint => schema.add_u64_field(&f.id, INDEXED | FAST),
                FieldType::Int | FieldType::Time => schema.add_i64_field(&f.id, INDEXED | FAST),
                FieldType::Float => schema.add_f64_field(&f.id, INDEXED | FAST),
            };
            let state = schema.add_text_field(&f.native_state, STRING | FAST);
            let exact = if f.field_type == FieldType::Text {
                schema.add_text_field(&f.native_exact, STRING | FAST)
            } else {
                value
            };
            fields.insert(f.id.clone(), (value, state, exact));
            if f.default_text {
                defaults.push(value);
            }
        }
        let mut hash = Sha256::new();
        hash.update(
            b"locus-search:tantivy-0.26.2:representation-1:hybrid-cjk-latin-1:extraction-1",
        );
        hash.update(serde_json::to_vec(catalogue)?);
        Ok(Self {
            schema: schema.build(),
            id,
            hi,
            lo,
            evidence,
            fields,
            defaults,
            fingerprint: format!("{:x}", hash.finalize()),
        })
    }
    pub fn configure(&self, index: &Index) {
        index
            .tokenizers()
            .register("locus_hybrid_v1", crate::analyzer::Hybrid);
    }
    pub fn document(
        &self,
        id: locus_core::api::EntityId,
        values: &[FieldValue],
    ) -> Result<TantivyDocument, SearchError> {
        let mut document = TantivyDocument::default();
        document.add_text(self.id, id.to_string());
        let bytes = id.as_bytes();
        document.add_u64(
            self.hi,
            u64::from_be_bytes(
                bytes[..8]
                    .try_into()
                    .map_err(|_| SearchError::Invalid("identity bytes".into()))?,
            ),
        );
        document.add_u64(
            self.lo,
            u64::from_be_bytes(
                bytes[8..]
                    .try_into()
                    .map_err(|_| SearchError::Invalid("identity bytes".into()))?,
            ),
        );
        document.add_bytes(self.evidence, &serde_json::to_vec(values)?);
        for projection in values {
            let (field, state, exact) = self.fields[&projection.field];
            document.add_text(
                state,
                match projection.value {
                    ValueState::Missing => "missing",
                    ValueState::Empty => "empty",
                    ValueState::Values(_) => "value",
                },
            );
            if let ValueState::Values(values) = &projection.value {
                for value in values {
                    match value {
                        Value::Text(v) => {
                            document.add_text(field, v);
                            document.add_text(exact, v);
                        }
                        Value::Identifier(v) => document.add_text(field, v),
                        Value::Uint(v) => document.add_u64(
                            field,
                            v.parse().map_err(|_| SearchError::Invalid("uint".into()))?,
                        ),
                        Value::Int(v) | Value::Time(v) => document.add_i64(
                            field,
                            v.parse()
                                .map_err(|_| SearchError::Invalid("integer".into()))?,
                        ),
                        Value::Float(v) => document.add_f64(field, *v),
                    }
                }
            } else if matches!(projection.value, ValueState::Empty) {
                // Empty scalar equality is represented in the exact field only;
                // collections never acquire an artificial member.
                // The compiler handles empty equality through the state field.
            }
        }
        Ok(document)
    }
}
