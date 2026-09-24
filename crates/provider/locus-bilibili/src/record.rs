use crate::{capture::BilibiliSnapshot, identity::BilibiliId};
use locus_file::api::FileId;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BilibiliRecord {
    pub id: BilibiliId,
    pub revision: i64,
    pub snapshot: BilibiliSnapshot,
    /// Historical comparison evidence; never an alternative input pointer or pin.
    pub basis: Option<FileId>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteOutcome {
    Accepted(Box<BilibiliRecord>),
    RejectedRevisionChanged,
    RejectedContextChanged,
}
