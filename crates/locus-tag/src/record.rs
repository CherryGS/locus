use crate::identity::TagId;
use locus_core::api::ComponentId;
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagRecord {
    pub id: TagId,
    pub name: String,
    pub revision: String,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagSetRecord {
    pub id: ComponentId,
    pub tags: Vec<TagRecord>,
}
