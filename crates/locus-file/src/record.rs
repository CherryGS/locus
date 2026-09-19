use crate::identity::FileId;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileRecord {
    pub id: FileId,
    pub relative_path: String,
    pub byte_count: u64,
}
