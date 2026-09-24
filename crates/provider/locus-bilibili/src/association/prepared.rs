use crate::identity::BilibiliId;
use locus_core::api::EntityId;
use locus_file::api::FileId;

/// An opaque observation of the intended snapshot revision and its actual host/File.
/// Preparation reads metadata only. Dropping a token has no persistent effects.
#[derive(Debug)]
pub struct PreparedAssociation {
    pub(super) id: BilibiliId,
    pub(super) revision: i64,
    pub(super) host: EntityId,
    pub(super) file: FileId,
}
