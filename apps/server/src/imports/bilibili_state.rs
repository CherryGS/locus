use super::model::{KindResult, State, Step};
use locus_bilibili::api::{BilibiliId, BilibiliSnapshot};
use locus_core::api::EntityId;
use locus_file::api::FileId;
use locus_media::api::MediaKind;

#[derive(Debug, Clone)]
pub(crate) struct CoverResult {
    pub file: FileId,
    pub entity: Option<EntityId>,
    pub establishment: Step,
    pub association: Step,
    pub image: KindResult,
}
#[derive(Debug, Clone)]
pub(crate) struct BilibiliResult {
    pub snapshot: BilibiliSnapshot,
    pub id: Option<BilibiliId>,
    pub revision: Option<i64>,
    pub source: Step,
    pub association: Step,
    pub cover: Option<CoverResult>,
}
impl BilibiliResult {
    pub fn new(snapshot: BilibiliSnapshot, file: bool, cover: Option<FileId>) -> Self {
        Self {
            snapshot,
            id: None,
            revision: None,
            source: Step::new(State::Pending),
            association: Step::new(if file {
                State::Pending
            } else {
                State::NotRequested
            }),
            cover: cover.map(|file| CoverResult {
                file,
                entity: None,
                establishment: Step::new(State::Pending),
                association: Step::new(State::Pending),
                image: KindResult::new(MediaKind::Image),
            }),
        }
    }
    pub fn complete(&self) -> bool {
        self.source.success()
            && matches!(self.association.state, State::Success | State::NotRequested)
            && self.cover.as_ref().is_none_or(|c| {
                c.establishment.success()
                    && c.association.success()
                    && c.image.recognition.success()
                    && c.image.complete()
            })
    }
    pub fn uncertain(&self) -> bool {
        self.source.state == State::Uncertain
            || self.association.state == State::Uncertain
            || self.cover.as_ref().is_some_and(|c| {
                [
                    c.establishment.state,
                    c.association.state,
                    c.image.establishment.state,
                    c.image.interpretation.state,
                ]
                .contains(&State::Uncertain)
            })
    }
}
