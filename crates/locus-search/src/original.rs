//! Stored selected values are the lossless authority for oversized terms. Tantivy
//! omits terms above its byte limit and truncates fast dictionaries. A bounded
//! field-presence posting locates exceptional documents; we then verify originals.
//! Ordinary terms still use native postings and scoring. No hash can admit a
//! different original, and no Component/source attribution is copied here.
use sha2::{Digest, Sha256};
use std::{ops::Bound, sync::Arc};
use tantivy::schema::Value as _;
use tantivy::{
    DocSet, SegmentReader, TERMINATED, TantivyDocument, Term,
    query::{EnableScoring, Explanation, Query, Scorer, TermQuery, Weight},
    schema::{Field, IndexRecordOption, OwnedValue},
};
use tantivy_fst::Automaton;

// JSON indexing keys add field-id (4), transient path-id (4), and type (1)
// before the token in tantivy-stacker's u16-sized key. This is four bytes
// tighter than MAX_TOKEN_LEN; values on that boundary also need lookup terms.
pub(crate) const MAX_TERM_BYTES: usize = 65_535 - 9;
pub(crate) fn lookup(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

pub(crate) fn values(
    doc: &TantivyDocument,
    field: Field,
    name: &str,
) -> tantivy::Result<Vec<OwnedValue>> {
    let fields = doc
        .get_first(field)
        .and_then(|v| v.as_object())
        .ok_or_else(|| {
            tantivy::TantivyError::InvalidArgument("missing stored selected originals".into())
        })?;
    for (key, value) in fields {
        if key == name {
            let array = value.as_array().ok_or_else(|| {
                tantivy::TantivyError::InvalidArgument(
                    "invalid stored selected original shape".into(),
                )
            })?;
            return Ok(array.map(|v| OwnedValue::from(v.as_value())).collect());
        }
    }
    Ok(Vec::new())
}
struct Documents {
    docs: Vec<(u32, f32)>,
    position: usize,
}
impl DocSet for Documents {
    fn advance(&mut self) -> u32 {
        self.position += 1;
        self.doc()
    }
    fn doc(&self) -> u32 {
        self.docs
            .get(self.position)
            .map(|v| v.0)
            .unwrap_or(TERMINATED)
    }
    fn size_hint(&self) -> u32 {
        self.docs.len() as u32
    }
}
impl Scorer for Documents {
    fn score(&mut self) -> f32 {
        self.docs.get(self.position).map_or(0.0, |v| v.1)
    }
}

#[derive(Clone, Debug)]
pub(crate) enum Match {
    Equal(String),
    Prefix(String),
    Set(Vec<String>),
    Range(Bound<String>, Bound<String>),
    Regex(Arc<tantivy_fst::Regex>),
}
impl Match {
    fn matches(&self, value: &str) -> bool {
        match self {
            Self::Equal(v) => v == value,
            Self::Prefix(v) => value.starts_with(v),
            Self::Set(vs) => vs.iter().any(|v| v == value),
            Self::Range(lo, hi) => {
                let lower = match lo {
                    Bound::Unbounded => true,
                    Bound::Included(v) => value >= v.as_str(),
                    Bound::Excluded(v) => value > v.as_str(),
                };
                let upper = match hi {
                    Bound::Unbounded => true,
                    Bound::Included(v) => value <= v.as_str(),
                    Bound::Excluded(v) => value < v.as_str(),
                };
                lower && upper
            }
            Self::Regex(regex) => {
                let mut state = regex.start();
                for b in value.bytes() {
                    state = regex.accept(&state, b);
                }
                regex.is_match(&state)
            }
        }
    }
}
#[derive(Debug)]
pub(crate) struct OriginalQuery {
    pub values: Field,
    pub marker: Field,
    pub field: String,
    pub matcher: Match,
    pub native: Option<Box<dyn Query>>,
}
impl Clone for OriginalQuery {
    fn clone(&self) -> Self {
        Self {
            values: self.values,
            marker: self.marker,
            field: self.field.clone(),
            matcher: self.matcher.clone(),
            native: self.native.as_ref().map(|q| q.box_clone()),
        }
    }
}
impl Query for OriginalQuery {
    fn weight(&self, scoring: EnableScoring<'_>) -> tantivy::Result<Box<dyn Weight>> {
        Ok(Box::new(OriginalWeight {
            query: self.clone(),
            native: self
                .native
                .as_ref()
                .map(|q| q.weight(scoring))
                .transpose()?,
        }))
    }
}
struct OriginalWeight {
    query: OriginalQuery,
    native: Option<Box<dyn Weight>>,
}
impl Weight for OriginalWeight {
    fn scorer(&self, reader: &SegmentReader, boost: f32) -> tantivy::Result<Box<dyn Scorer>> {
        let marker = TermQuery::new(
            Term::from_field_text(self.query.marker, &self.query.field),
            IndexRecordOption::Basic,
        );
        let marker_weight = marker.weight(EnableScoring::disabled_from_schema(reader.schema()))?;
        let weight = self.native.as_deref().unwrap_or(&*marker_weight);
        let mut candidates = weight.scorer(reader, boost)?;
        let store = reader.get_store_reader(1)?;
        let mut docs = Vec::new();
        while candidates.doc() != TERMINATED {
            let id = candidates.doc();
            if reader.is_deleted(id) {
                candidates.advance();
                continue;
            }
            let doc: TantivyDocument = store.get(id)?;
            if values(&doc, self.query.values, &self.query.field)?
                .iter()
                .any(|v| matches!(v, OwnedValue::Str(s) if self.query.matcher.matches(s)))
            {
                docs.push((
                    id,
                    if self.native.is_some() {
                        candidates.score()
                    } else {
                        boost
                    },
                ));
            }
            candidates.advance();
        }
        Ok(Box::new(Documents { docs, position: 0 }))
    }
    fn explain(&self, reader: &SegmentReader, doc: u32) -> tantivy::Result<Explanation> {
        let mut scorer = self.scorer(reader, 1.0)?;
        if scorer.seek(doc) == doc {
            Ok(Explanation::new(
                "Verified complete original",
                scorer.score(),
            ))
        } else {
            Err(tantivy::TantivyError::InvalidArgument(
                "Original does not match".into(),
            ))
        }
    }
}
