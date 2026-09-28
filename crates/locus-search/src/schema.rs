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
    pub values: Field,
    pub text: Field,
    pub presence: Field,
    pub defaults: Vec<Field>,
    pub catalogue: Catalogue,
    pub fingerprint: String,
}
impl Mapping {
    pub fn new(catalogue: &Catalogue) -> Result<Self, SearchError> {
        let mut schema = Schema::builder();
        let id = schema.add_text_field("_entity", STRING);
        let hi = schema.add_u64_field("_id_hi", FAST);
        let lo = schema.add_u64_field("_id_lo", FAST);
        let raw = JsonObjectOptions::default()
            .set_indexing_options(
                TextFieldIndexing::default()
                    .set_tokenizer("raw")
                    .set_index_option(IndexRecordOption::WithFreqsAndPositions),
            )
            .set_fast(None);
        let analyzed = TextFieldIndexing::default()
            .set_tokenizer("locus_hybrid_v1")
            .set_index_option(IndexRecordOption::WithFreqsAndPositions);
        let values = schema.add_json_field("_values", raw);
        let text = schema.add_json_field(
            "_text",
            JsonObjectOptions::default()
                .set_indexing_options(analyzed.clone())
                .set_fast(Some("locus_hybrid_v1")),
        );
        let presence = schema.add_text_field("_presence", STRING);
        let aggregate = schema.add_text_field(
            "_aggregate",
            TextOptions::default().set_indexing_options(analyzed),
        );
        let mut hash = Sha256::new();
        hash.update(
            b"locus-search:tantivy-0.26.2:selected-json-2:aggregate-gap-1:normalized-presence-1",
        );
        hash.update(serde_json::to_vec(catalogue)?);
        Ok(Self {
            schema: schema.build(),
            id,
            hi,
            lo,
            values,
            text,
            presence,
            defaults: vec![aggregate],
            catalogue: catalogue.clone(),
            fingerprint: format!("{:x}", hash.finalize()),
        })
    }
    pub fn configure(&self, index: &Index) {
        index
            .tokenizers()
            .register("locus_hybrid_v1", crate::analyzer::Hybrid);
        index
            .fast_field_tokenizer()
            .register("locus_hybrid_v1", crate::analyzer::Hybrid);
    }
    pub fn reference(&self, name: &str) -> Result<String, SearchError> {
        let d = self
            .catalogue
            .fields
            .iter()
            .find(|d| d.native_value == name || d.native_exact == name)
            .ok_or_else(|| SearchError::Native(format!("undeclared field {name}")))?;
        Ok(format!(
            "{}.{}",
            if d.field_type == FieldType::Text && name == d.native_value {
                "_text"
            } else {
                "_values"
            },
            d.id
        ))
    }
    pub fn document(
        &self,
        id: locus_core::api::EntityId,
        values: &[FieldValue],
    ) -> Result<TantivyDocument, SearchError> {
        let mut doc = TantivyDocument::default();
        doc.add_text(self.id, id.to_string());
        doc.add_u64(
            self.hi,
            u64::from_be_bytes(
                id.as_bytes()[..8]
                    .try_into()
                    .map_err(|_| SearchError::Invalid("id".into()))?,
            ),
        );
        doc.add_u64(
            self.lo,
            u64::from_be_bytes(
                id.as_bytes()[8..]
                    .try_into()
                    .map_err(|_| SearchError::Invalid("id".into()))?,
            ),
        );
        let mut selected = BTreeMap::new();
        let mut text = BTreeMap::new();
        let mut fragments = Vec::new();
        for projection in values {
            let definition = self.catalogue.field(&projection.field)?;
            let ValueState::Values(values) = &projection.value else {
                continue;
            };
            if values.is_empty() {
                continue;
            }
            doc.add_text(self.presence, &projection.field);
            let mut typed = Vec::new();
            let mut analyzed = Vec::new();
            for value in values {
                let v = match value {
                    Value::Identifier(v) => OwnedValue::Str(v.clone()),
                    Value::Text(v) => {
                        analyzed.push(OwnedValue::Str(v.clone()));
                        if definition.default_text {
                            fragments.push(v.clone());
                        }
                        OwnedValue::Str(v.clone())
                    }
                    Value::Uint(v) => {
                        OwnedValue::U64(v.parse().map_err(|_| SearchError::Invalid("uint".into()))?)
                    }
                    Value::Int(v) | Value::Time(v) => OwnedValue::I64(
                        v.parse()
                            .map_err(|_| SearchError::Invalid("integer".into()))?,
                    ),
                    Value::Float(v) => OwnedValue::F64(*v),
                };
                typed.push(v);
            }
            selected.insert(projection.field.clone(), OwnedValue::Array(typed));
            if !analyzed.is_empty() {
                text.insert(projection.field.clone(), OwnedValue::Array(analyzed));
            }
        }
        doc.add_object(self.values, selected);
        doc.add_object(self.text, text);
        // A tokenizer-recognized boundary increments positions without adding a
        // searchable sentinel term. It prevents cross-fragment zero-slop phrases.
        doc.add_text(self.defaults[0], fragments.join("\u{001f}"));
        Ok(doc)
    }
}
