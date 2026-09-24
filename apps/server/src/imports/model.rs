use locus_core::api::EntityId;
use locus_file::api::{CopyProgress, FileId, PreparedFile};
use locus_media::api::{MediaId, MediaKind, Preview};
use locus_twitter::api::{TwitterId, TwitterSnapshot};
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum State {
    NotRequested,
    Pending,
    Running,
    Success,
    NoMatch,
    Failed,
    Uncertain,
    Conflict,
    Skipped,
}
#[derive(Debug, Clone)]
pub(crate) struct Step {
    pub state: State,
    pub reason: Option<String>,
}
impl Step {
    pub fn new(state: State) -> Self {
        Self {
            state,
            reason: None,
        }
    }
    pub fn error(state: State, reason: impl ToString) -> Self {
        Self {
            state,
            reason: Some(reason.to_string()),
        }
    }
    pub fn success(&self) -> bool {
        self.state == State::Success
    }
}
#[derive(Debug, Clone)]
pub(crate) struct KindResult {
    pub kind: MediaKind,
    pub recognition: Step,
    pub establishment: Step,
    pub interpretation: Step,
    pub preview: Step,
    pub component: Option<MediaId>,
    pub revision: Option<i64>,
    pub output: Option<Arc<Preview>>,
    pub locator: Option<String>,
}
impl KindResult {
    pub fn new(kind: MediaKind) -> Self {
        Self {
            kind,
            recognition: Step::new(State::Pending),
            establishment: Step::new(State::Pending),
            interpretation: Step::new(State::Pending),
            preview: Step::new(State::Pending),
            component: None,
            revision: None,
            output: None,
            locator: None,
        }
    }
    pub fn complete(&self) -> bool {
        self.recognition.state == State::NoMatch
            || (self.recognition.success()
                && self.establishment.success()
                && self.interpretation.success()
                && self.preview.success())
    }
}
#[derive(Debug, Clone)]
pub(crate) struct ModelResult {
    pub recognition: Step,
    pub establishment: Step,
    pub inspection: Step,
    pub component: Option<locus_model::api::ModelId>,
    pub revision: Option<i64>,
}
impl ModelResult {
    pub fn new() -> Self {
        Self {
            recognition: Step::new(State::Pending),
            establishment: Step::new(State::Pending),
            inspection: Step::new(State::Pending),
            component: None,
            revision: None,
        }
    }
    pub fn complete(&self) -> bool {
        matches!(self.recognition.state, State::NotRequested | State::NoMatch)
            || (self.recognition.success()
                && self.establishment.success()
                && self.inspection.success())
    }
}
#[derive(Debug, Clone)]
pub(crate) struct ResultState {
    pub observation_problem: Option<String>,
    pub copy: Step,
    pub registration: Step,
    pub file_attachment: Step,
    pub twitter: Step,
    pub association: Step,
    pub twitter_id: Option<TwitterId>,
    pub twitter_revision: Option<i64>,
    pub base: Step,
    pub entity: Option<EntityId>,
    pub file: Option<FileId>,
    pub progress: Option<CopyProgress>,
    pub kinds: Vec<KindResult>,
    pub model: ModelResult,
    pub civitai: Option<locus_civitai::api::Enrichment>,
    pub effect: u64,
}
impl ResultState {
    pub fn new() -> Self {
        Self {
            observation_problem: None,
            copy: Step::new(State::Pending),
            registration: Step::new(State::Pending),
            file_attachment: Step::new(State::Pending),
            twitter: Step::new(State::NotRequested),
            association: Step::new(State::NotRequested),
            twitter_id: None,
            twitter_revision: None,
            base: Step::new(State::Pending),
            entity: None,
            file: None,
            progress: None,
            model: ModelResult::new(),
            civitai: None,
            kinds: vec![
                KindResult::new(MediaKind::Image),
                KindResult::new(MediaKind::Video),
            ],
            effect: 0,
        }
    }
    pub fn complete(&self) -> bool {
        self.observation_problem.is_none()
            && self.base.success()
            && [
                &self.registration,
                &self.file_attachment,
                &self.twitter,
                &self.association,
            ]
            .iter()
            .all(|s| s.success() || s.state == State::NotRequested)
            && self.kinds.iter().all(KindResult::complete)
            && self.model.complete()
            && (!self.model.recognition.success()
                || self
                    .civitai
                    .as_ref()
                    .is_some_and(|w| w.state() == locus_civitai::api::EnrichmentState::Complete))
    }
    pub fn uncertain(&self) -> bool {
        if self
            .civitai
            .as_ref()
            .is_some_and(|w| w.state() == locus_civitai::api::EnrichmentState::Uncertain)
        {
            return true;
        }
        [
            &self.base,
            &self.registration,
            &self.file_attachment,
            &self.twitter,
            &self.association,
        ]
        .iter()
        .any(|s| s.state == State::Uncertain)
            || self.model.establishment.state == State::Uncertain
            || self.model.inspection.state == State::Uncertain
            || self.kinds.iter().any(|k| {
                k.establishment.state == State::Uncertain
                    || k.interpretation.state == State::Uncertain
            })
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Action {
    Original,
    Retry,
    Recopy,
    Confirm,
}
#[derive(Debug, Clone)]
pub(crate) struct Attempt {
    pub id: String,
    pub action: Action,
    pub ended: bool,
    pub result: ResultState,
}
#[derive(Debug, Clone)]
pub(crate) struct Item {
    pub id: String,
    pub source: String,
    pub supplied: bool,
    pub snapshot: Option<TwitterSnapshot>,
    pub current: ResultState,
    pub attempts: Vec<Attempt>,
    pub active: Option<String>,
    pub prepared: Option<PreparedFile>,
}
#[derive(Debug, Clone)]
pub(crate) struct Batch {
    pub access_context: crate::api::task::dto::AccessContext,
    pub original_request_id: String,
    pub id: String,
    pub items: Vec<Item>,
    pub ended: bool,
}

pub(crate) type RegisteredInput = (Option<FileId>, Option<TwitterSnapshot>);
