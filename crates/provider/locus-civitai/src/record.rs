use crate::{identity::CivitaiId, snapshot::Snapshot};
use locus_file::api::FileId;

#[derive(Debug, Clone, PartialEq)]
pub struct CivitaiRecord {
    pub id: CivitaiId,
    /// Changes only when complete metadata is accepted, not during example work.
    pub revision: i64,
    pub observation: String,
    pub basis: FileId,
    pub snapshot: Snapshot,
    pub examples: Vec<crate::examples::ExampleBinding>,
}
