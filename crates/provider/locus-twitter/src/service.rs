use crate::{error::TwitterError, persistence};
use locus_store::api::Session;

#[derive(Debug, Clone, Copy, Default)]
pub struct TwitterService;
impl TwitterService {
    pub fn new() -> Self {
        Self
    }
    pub async fn initialize(&self, session: &mut Session) -> Result<(), TwitterError> {
        session
            .transaction(|c| Box::pin(persistence::initialize(c)))
            .await
    }
}
