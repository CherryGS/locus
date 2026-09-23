use crate::{error::ModelError, persistence};
use locus_store::api::Session;
#[derive(Clone, Default)]
pub struct ModelService {
    pub(crate) stage: Option<locus_task::api::Stage>,
}
impl ModelService {
    pub fn new() -> Self {
        Self::default()
    }
    pub async fn initialize(&self, session: &mut Session) -> Result<(), ModelError> {
        session
            .transaction(|c| Box::pin(persistence::initialize(c)))
            .await
    }
}
