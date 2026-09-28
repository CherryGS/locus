use crate::{error::StoreError, session::Session};
use locus_task::api::Stage;
use std::path::PathBuf;

/// Owns actual database exclusion. Participating sessions retain this stage
/// through their protected workers even after the caller abandons a future.
pub struct ProtectedDatabase {
    path: PathBuf,
    stage: Stage,
}
impl ProtectedDatabase {
    pub(crate) fn new(path: PathBuf, stage: Stage) -> Self {
        Self { path, stage }
    }
    pub async fn session(&self) -> Result<Session, StoreError> {
        let mut session = Session::open(&self.path).await?;
        session.participating = Some(self.stage.clone());
        Ok(session)
    }
}
