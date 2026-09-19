use crate::{capture::TwitterSnapshot, identity::TwitterId};
use locus_file::api::FileId;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TwitterRecord {
    pub id: TwitterId,
    pub revision: i64,
    pub snapshot: TwitterSnapshot,
    /// Historical comparison evidence; never an alternative input pointer or pin.
    pub basis: Option<FileId>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteOutcome {
    Accepted(Box<TwitterRecord>),
    RejectedRevisionChanged,
    RejectedContextChanged,
}
