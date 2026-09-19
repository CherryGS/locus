use crate::{
    error::{AttemptFailure, MediaError},
    facts::Facts,
    identity::{MediaId, MediaKind},
};
use locus_file::api::FileId;

#[derive(Debug, Clone, PartialEq)]
pub struct MediaRecord {
    pub id: MediaId,
    pub revision: i64,
    pub basis: Option<FileId>,
    pub facts: Option<Facts>,
    pub last_failure: Option<AttemptFailure>,
}

impl MediaRecord {
    pub(crate) fn validate(&self) -> Result<(), MediaError> {
        let invalid =
            || MediaError::Corrupt(format!("invalid facts/basis/revision for {:?}", self.id));
        if self.revision < 0 || self.basis.is_some() != self.facts.is_some() {
            return Err(invalid());
        }
        match &self.facts {
            Some(Facts::Image(f))
                if self.id.kind() == MediaKind::Image && f.width > 0 && f.height > 0 => {}
            Some(Facts::Video(f)) if self.id.kind() == MediaKind::Video => {
                if !matches!(f.container.as_str(), "mov" | "matroska")
                    || f.codec
                        .as_ref()
                        .is_some_and(|v| v.is_empty() || v.len() > 128)
                    || f.width == Some(0)
                    || f.height == Some(0)
                    || f.duration.as_ref().is_some_and(|d| {
                        !d.seconds.is_finite() || d.seconds < 0.0 || d.seconds > 315_576_000.0
                    })
                {
                    return Err(invalid());
                }
            }
            None => (),
            _ => return Err(invalid()),
        }
        if self
            .last_failure
            .as_ref()
            .is_some_and(|f| f.detail.is_empty() || f.detail.chars().count() > 4096)
        {
            return Err(invalid());
        }
        Ok(())
    }
}
