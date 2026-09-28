use crate::{error::StoreError, session::Session};
use locus_task::api::{Resource, TaskContext, TaskQueue};
use std::path::{Path, PathBuf};

/// Explicit task-aware access to a configured SQLite file. Canonical paths share
/// one queue resource, including separately constructed capabilities. Hard-link
/// aliases and external/standalone connections are outside this cooperative scope.
#[derive(Clone)]
pub struct TaskDatabase {
    path: PathBuf,
    resource: Resource,
}

impl TaskDatabase {
    /// Own one database resource through final projection and native read capture.
    /// Participating sessions reuse this lease and never re-enter the DB key.
    pub async fn protect(
        &self,
        task: &TaskContext,
    ) -> Result<crate::protected::ProtectedDatabase, StoreError> {
        let stage = task
            .enter(
                "Aligned database observation",
                std::slice::from_ref(&self.resource),
            )
            .await?;
        Ok(crate::protected::ProtectedDatabase::new(
            self.path.clone(),
            stage,
        ))
    }
    pub async fn open(queue: &TaskQueue, path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path = path.as_ref().to_path_buf();
        let path = tokio::task::spawn_blocking(move || {
            std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(false)
                .open(&path)?;
            std::fs::canonicalize(path)
        })
        .await
        .map_err(|e| locus_task::api::TaskError::Worker(e.to_string()))??;
        let identity = path.to_str().ok_or(StoreError::InvalidPath)?;
        let resource = queue.named_resource(format!("locus-store:sqlite:{identity}"));
        Ok(Self { path, resource })
    }

    pub async fn session(&self, task: &TaskContext) -> Result<Session, StoreError> {
        let _stage = task
            .enter("Database connection", std::slice::from_ref(&self.resource))
            .await?;
        let mut session = Session::open(&self.path).await?;
        session.binding = Some((task.clone(), self.resource.clone()));
        Ok(session)
    }

    /// Each call creates a distinct SQLite memory database and resource.
    pub async fn memory(queue: &TaskQueue, task: &TaskContext) -> Result<Session, StoreError> {
        let resource = queue.resource();
        let _stage = task
            .enter(
                "Memory database connection",
                std::slice::from_ref(&resource),
            )
            .await?;
        let mut session = Session::memory().await?;
        session.binding = Some((task.clone(), resource));
        Ok(session)
    }
}
