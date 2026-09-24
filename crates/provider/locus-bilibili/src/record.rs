use crate::{capture::BilibiliSnapshot, identity::BilibiliId};
use locus_core::api::EntityId;
use locus_file::api::FileId;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OriginalCover {
    pub entity: EntityId,
    pub file: FileId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BilibiliRecord {
    pub id: BilibiliId,
    pub revision: i64,
    pub snapshot: BilibiliSnapshot,
    /// Historical comparison evidence; never an alternative input pointer or pin.
    pub basis: Option<FileId>,
    pub original_cover: Option<OriginalCover>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteOutcome {
    Accepted(Box<BilibiliRecord>),
    RejectedRevisionChanged,
    RejectedContextChanged,
}
