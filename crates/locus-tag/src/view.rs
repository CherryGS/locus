use crate::record::TagRecord;

/// An authored document and its coherent Tag edit observation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagDocument {
    pub tag: TagRecord,
    pub markdown: String,
}
