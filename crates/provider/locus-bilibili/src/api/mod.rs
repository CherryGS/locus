pub use crate::association::PreparedAssociation;
pub use crate::capture::{
    AuthorObservation, BilibiliSnapshot, CaptureIssue, CapturePortion, MediaClaims,
    PartObservation, RemotePreview, SelectedRepresentation, ValidationError,
};
pub use crate::error::BilibiliError;
pub use crate::identity::{BILIBILI_KIND, BilibiliId};
pub use crate::owner::BilibiliOwner;
pub use crate::record::{BilibiliRecord, OriginalCover, WriteOutcome};
pub use crate::service::BilibiliService;
pub use crate::view::{BilibiliApplicability, BilibiliEntry, BilibiliView, CoverApplicability};

pub use crate::cover::PreparedCover;

pub use crate::query::BilibiliQueryProvider;
