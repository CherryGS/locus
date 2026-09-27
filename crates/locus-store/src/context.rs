use std::{future::Future, pin::Pin};

use diesel_async::SimpleAsyncConnection;

use crate::{error::StoreError, session::Connection};

pub type TransactionFuture<'a, T, E> = Pin<Box<dyn Future<Output = Result<T, E>> + Send + 'a>>;

/// A participant in one actual transaction. Successful results are provisional
/// until the session's transaction returns success.
///
/// Raw Diesel access is for trusted owners: do not issue transaction-control SQL,
/// disable constraints, mutate unrelated owners' tables, or use a second connection
/// for participating writes. Historical migration steps may evolve their declared
/// schemas and rows under the owning domains' contracts, but still leave transaction
/// control to the caller. Domains must route admitted component deletion through
/// their guarded core facade; raw access is not a sandbox against malicious owners.
pub struct Context {
    connection: Connection,
    stage: Option<locus_task::api::Stage>,
    poisoned: bool,
    next_savepoint: u64,
    open_savepoints: u64,
}

impl Context {
    pub(crate) fn new(connection: Connection, stage: Option<locus_task::api::Stage>) -> Self {
        Self {
            connection,
            stage,
            poisoned: false,
            next_savepoint: 0,
            open_savepoints: 0,
        }
    }

    pub(crate) fn is_clean(&self) -> bool {
        !self.poisoned && self.open_savepoints == 0
    }

    pub(crate) fn into_connection(self) -> Connection {
        self.connection
    }

    /// Retain this transaction's stage through actual auxiliary blocking work.
    pub fn spawn_blocking<T, F>(&self, operation: F) -> tokio::task::JoinHandle<T>
    where
        T: Send + 'static,
        F: FnOnce() -> T + Send + 'static,
    {
        match &self.stage {
            Some(stage) => stage.spawn_blocking(move |_| operation()),
            None => tokio::task::spawn_blocking(operation),
        }
    }

    pub fn connection(&mut self) -> &mut Connection {
        &mut self.connection
    }

    /// Participants can report their domain phase without entering another stage.
    pub fn task_stage(&self) -> Option<&locus_task::api::Stage> {
        self.stage.as_ref()
    }

    /// Keep a multi-write participant atomic even if its caller catches the error.
    /// It still leaves the outer commit/rollback entirely to the transaction owner.
    pub async fn savepoint<T, E, F>(&mut self, operation: F) -> Result<T, E>
    where
        E: From<StoreError> + std::fmt::Display,
        F: for<'a> FnOnce(&'a mut Context) -> TransactionFuture<'a, T, E>,
    {
        if self.poisoned {
            return Err(StoreError::Poisoned.into());
        }
        let name = format!("locus_store_{}", self.next_savepoint);
        self.next_savepoint += 1;
        // An unfinished depth survives cancellation during any await, including the
        // participant body. Only confirmed RELEASE/rollback removes this frame.
        let parent_depth = self.open_savepoints;
        self.open_savepoints += 1;
        self.connection
            .batch_execute(&format!("SAVEPOINT {name}"))
            .await
            .map_err(StoreError::from)?;
        let result = operation(self).await;
        let child_poisoned = self.poisoned || self.open_savepoints != parent_depth + 1;
        match result {
            Ok(value) if !child_poisoned => {
                self.connection
                    .batch_execute(&format!("RELEASE SAVEPOINT {name}"))
                    .await
                    .map_err(StoreError::from)?;
                self.open_savepoints = parent_depth;
                Ok(value)
            }
            result => {
                let error = match result {
                    Err(error) => error,
                    Ok(_) => StoreError::Poisoned.into(),
                };
                self.connection
                    .batch_execute(&format!(
                        "ROLLBACK TO SAVEPOINT {name}; RELEASE SAVEPOINT {name}"
                    ))
                    .await
                    .map_err(|rollback| StoreError::RollbackFailed {
                        operation: error.to_string(),
                        rollback,
                    })?;
                self.open_savepoints = parent_depth;
                self.poisoned = child_poisoned;
                Err(error)
            }
        }
    }
}
