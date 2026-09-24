use crate::{identity::CivitaiId, record::CivitaiRecord};
use locus_core::api::EntityId;
use locus_file::api::FileId;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnrichmentState {
    Pending,
    Running,
    Complete,
    Failed,
    Conflict,
    Uncertain,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetadataState {
    Pending,
    Accepted,
    NoMatch,
    Failed,
    Conflict,
    Uncertain,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Captured {
    pub host: EntityId,
    pub file: FileId,
    pub slot: Option<(CivitaiId, i64)>,
}
/// Run-local original work. Retain this value across an explicit continuation;
/// retained snapshots alone cannot reconstruct lost admission evidence.
#[derive(Debug, Clone)]
pub struct Enrichment {
    pub(crate) entity: EntityId,
    pub(crate) file: FileId,
    pub(crate) first_only: bool,
    pub(crate) state: EnrichmentState,
    pub(crate) metadata: MetadataState,
    pub(crate) record: Option<CivitaiRecord>,
    pub(crate) problem: Option<String>,
    pub(crate) effect: u64,
    pub(crate) captured: Option<Captured>,
    pub(crate) candidate: Option<CivitaiRecord>,
    pub(crate) examples: Vec<crate::examples::ExampleWork>,
}
impl Enrichment {
    pub fn new(entity: EntityId, file: FileId, first_only: bool) -> Self {
        Self {
            entity,
            file,
            first_only,
            state: EnrichmentState::Pending,
            metadata: MetadataState::Pending,
            record: None,
            problem: None,
            effect: 0,
            captured: None,
            candidate: None,
            examples: Vec::new(),
        }
    }
    pub fn examples(&self) -> impl Iterator<Item = crate::examples::ExampleOutcome> + '_ {
        self.examples.iter().map(|e| {
            let mut outcome = e.outcome.clone();
            outcome.file_registered = e.registered || outcome.binding.is_some();
            outcome.target_candidate = e
                .target_candidate
                .or_else(|| outcome.binding.as_ref().map(|b| b.entity));
            outcome.target_confirmed = outcome.binding.is_some() && !e.target_uncertain;
            outcome.registration_uncertain = e.registration_uncertain;
            outcome
        })
    }
    pub fn entity(&self) -> EntityId {
        self.entity
    }
    pub fn file(&self) -> FileId {
        self.file
    }
    pub fn first_only(&self) -> bool {
        self.first_only
    }
    pub fn state(&self) -> EnrichmentState {
        self.state
    }
    pub fn metadata(&self) -> MetadataState {
        self.metadata
    }
    pub fn record(&self) -> Option<&CivitaiRecord> {
        self.record.as_ref()
    }
    pub fn known_component(&self) -> Option<CivitaiId> {
        self.record
            .as_ref()
            .or(self.candidate.as_ref())
            .map(|r| r.id)
    }
    pub fn known_observation(&self) -> Option<&str> {
        self.record
            .as_ref()
            .or(self.candidate.as_ref())
            .map(|r| r.observation.as_str())
    }
    pub fn problem(&self) -> Option<&str> {
        self.problem.as_deref()
    }
    pub fn effect(&self) -> u64 {
        self.effect
    }
}
