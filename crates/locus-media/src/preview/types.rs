use crate::identity::MediaKind;
use locus_file::api::FileId;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rendition {
    pub edge: u32,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreviewOrigin {
    Hit,
    Generated,
}
#[derive(Debug)]
pub struct Preview {
    pub file: FileId,
    pub kind: MediaKind,
    pub rendition: Rendition,
    pub stream_index: Option<u32>,
    pub path: PathBuf,
    pub origin: PreviewOrigin,
}
