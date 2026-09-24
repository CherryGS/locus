use crate::snapshot::PreviewImage;
use locus_core::api::{ComponentId, EntityId};
use locus_file::api::{FileId, PreparedFile};
use locus_media::api::{ImageId, MediaId, VideoId};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MediaCompletion {
    #[serde(with = "crate::serde_ids::component")]
    pub component: ComponentId,
    pub image: bool,
    pub revision: i64,
    pub preview_edge: u32,
    pub stream_index: Option<u32>,
}
impl MediaCompletion {
    pub fn id(&self) -> MediaId {
        if self.image {
            ImageId::from_component(self.component).into()
        } else {
            VideoId::from_component(self.component).into()
        }
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExampleBinding {
    pub occurrence: usize,
    pub representation: PreviewImage,
    #[serde(with = "crate::serde_ids::entity")]
    pub entity: EntityId,
    #[serde(with = "crate::serde_ids::file")]
    pub file: FileId,
    pub acquired_observation: String,
    pub content_type: String,
    pub media: Vec<MediaCompletion>,
    pub complete: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExampleState {
    Pending,
    Running,
    Complete,
    Failed,
    Conflict,
    Uncertain,
}
#[derive(Debug, Clone)]
pub struct ExampleOutcome {
    pub preparations: Vec<locus_file::api::CopyProgress>,
    pub file_registered: bool,
    pub target_candidate: Option<EntityId>,
    pub target_confirmed: bool,
    pub registration_uncertain: bool,
    pub occurrence: usize,
    pub representation: PreviewImage,
    pub state: ExampleState,
    pub binding: Option<ExampleBinding>,
    pub reused: bool,
    pub prepared_file: Option<FileId>,
    pub problem: Option<String>,
}
#[derive(Debug, Clone)]
pub(crate) struct ExampleWork {
    pub interpretation_uncertain: Vec<MediaId>,
    pub effect: u64,
    pub content_type: Option<String>,
    pub outcome: ExampleOutcome,
    pub prepared: Option<PreparedFile>,
    pub registered: bool,
    pub registration_uncertain: bool,
    pub target_candidate: Option<EntityId>,
    pub target_uncertain: bool,
    pub recognition: Option<locus_media::api::FileRecognition>,
    pub components: Vec<MediaCompletion>,
    pub component_uncertain: bool,
    pub relationship_uncertain: bool,
    pub relationship_confirmed: bool,
}
impl ExampleWork {
    pub fn new(occurrence: usize, representation: PreviewImage) -> Self {
        Self {
            interpretation_uncertain: Vec::new(),
            effect: 0,
            content_type: None,
            outcome: ExampleOutcome {
                preparations: Vec::new(),
                file_registered: false,
                target_candidate: None,
                target_confirmed: false,
                registration_uncertain: false,
                occurrence,
                representation,
                state: ExampleState::Pending,
                binding: None,
                reused: false,
                prepared_file: None,
                problem: None,
            },
            prepared: None,
            registered: false,
            registration_uncertain: false,
            target_candidate: None,
            target_uncertain: false,
            recognition: None,
            components: Vec::new(),
            component_uncertain: false,
            relationship_uncertain: false,
            relationship_confirmed: false,
        }
    }
}
