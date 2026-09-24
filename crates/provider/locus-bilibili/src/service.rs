use crate::{error::BilibiliError, persistence};
use locus_store::api::Session;

#[derive(Debug, Clone, Copy, Default)]
pub struct BilibiliService;
impl BilibiliService {
    pub fn new() -> Self {
        Self
    }
    pub async fn initialize(&self, session: &mut Session) -> Result<(), BilibiliError> {
        session
            .transaction(|c| Box::pin(persistence::initialize(c)))
            .await
    }
}
