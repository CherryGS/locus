use locus_query::api::{Condition, Program};
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Instant};
use tantivy::{Index, IndexReader, Searcher};

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
pub struct SearchRequest {
    #[serde(default)]
    pub text: String,
    pub filter: Option<Condition>,
}
#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
pub struct SearchStatus {
    pub state: String,
    pub usable: bool,
    pub generation: Option<String>,
    pub covered_sequence: String,
    pub journal_head: String,
    pub completed: String,
    pub total: Option<String>,
    pub failure: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Checkpoint {
    pub identity: String,
    pub fingerprint: String,
    pub generation: String,
    pub covered: i64,
}
#[derive(Clone)]
pub(crate) struct Publication {
    pub(super) _lease: Arc<()>,
    pub index: Index,
    pub reader: IndexReader,
    pub checkpoint: Checkpoint,
}
#[derive(Clone)]
pub(crate) struct QueryContext {
    pub searcher: Searcher,
    pub publication: Publication,
    pub request: SearchRequest,
    pub program: Option<Program>,
    pub bindings: crate::reference::Bindings,
    pub expires: Instant,
}
pub struct SearchResult {
    pub bytes: Vec<u8>,
    pub context: String,
    pub generation: String,
    pub covered_sequence: String,
    pub expires_after_seconds: u64,
}
#[cfg(test)]
pub(crate) fn test_publication(index: Index, reader: IndexReader) -> Publication {
    Publication {
        _lease: Arc::new(()),
        index,
        reader,
        checkpoint: Checkpoint {
            identity: "fixture".into(),
            fingerprint: "fixture".into(),
            generation: "fixture".into(),
            covered: 0,
        },
    }
}
