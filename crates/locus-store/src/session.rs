use std::{future::Future, path::Path, pin::Pin};

use diesel::SqliteConnection;
use diesel_async::{
    AsyncConnection, SimpleAsyncConnection, sync_connection_wrapper::SyncConnectionWrapper,
};

use crate::StoreError;

pub type Connection = SyncConnectionWrapper<SqliteConnection>;
pub type TransactionFuture<'a, T, E> = Pin<Box<dyn Future<Output = Result<T, E>> + Send + 'a>>;

/// An owned SQLite connection using the caller's multi-thread Tokio runtime.
///
/// Dropping an in-flight transaction discards its connection and makes this session
/// unusable. SQLite rolls back unfinished work when the driver's outstanding work
/// and connection are disposed. If COMMIT may have run, cancellation does not prove
/// rollback: reopen and reconcile using durable identities before retrying.
pub struct Session {
    connection: Option<Connection>,
}

/// A participant in one actual transaction. Successful results are provisional
/// until the session's transaction returns success.
///
/// Raw Diesel access is for trusted owners: do not issue transaction-control SQL,
/// disable constraints, mutate another owner's tables, or use a second connection
/// for participating writes. Domains must route admitted component deletion through
/// their guarded core facade; raw access is not a sandbox against malicious owners.
pub struct Context {
    connection: Connection,
    poisoned: bool,
    next_savepoint: u64,
    open_savepoints: u64,
}

impl Session {
    pub async fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        Self::connect(path.as_ref().to_str().ok_or(StoreError::InvalidPath)?).await
    }

    pub async fn memory() -> Result<Self, StoreError> {
        Self::connect(":memory:").await
    }

    async fn connect(url: &str) -> Result<Self, StoreError> {
        require_runtime()?;
        let mut connection = Connection::establish(url).await?;
        // A bounded wait handles independent SQLite writers without a retry service.
        connection
            .batch_execute("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;")
            .await?;
        Ok(Self {
            connection: Some(connection),
        })
    }

    pub fn is_usable(&self) -> bool {
        self.connection.is_some()
    }

    /// Execute a standalone unit or compose domain and core writes. Propagate a
    /// required participant failure to roll back the whole unit. No hidden runtime,
    /// pool, or nested independent commit is created. Return values are durable only
    /// on `Ok`; commit errors explicitly have an uncertain outcome.
    pub async fn transaction<T, E, F>(&mut self, operation: F) -> Result<T, E>
    where
        E: From<StoreError> + std::fmt::Display,
        F: for<'a> FnOnce(&'a mut Context) -> TransactionFuture<'a, T, E>,
    {
        require_runtime()?;
        // Ownership, rather than Drop issuing async rollback, makes cancellation safe.
        // The wrapper can leave BEGIN open when its future is canceled. Never put its
        // connection back into the session until a complete clean boundary is known.
        let connection = self.connection.take().ok_or(StoreError::Discarded)?;
        let mut context = Context {
            connection,
            poisoned: false,
            next_savepoint: 0,
            open_savepoints: 0,
        };
        context
            .connection
            .batch_execute("BEGIN IMMEDIATE")
            .await
            .map_err(StoreError::from)?;
        let result = operation(&mut context).await;
        match result {
            Ok(value) if !context.poisoned && context.open_savepoints == 0 => {
                context
                    .connection
                    .batch_execute("COMMIT")
                    .await
                    .map_err(StoreError::CommitOutcomeUnknown)?;
                self.connection = Some(context.connection);
                Ok(value)
            }
            result => {
                let error = match result {
                    Err(error) => error,
                    Ok(_) => StoreError::Poisoned.into(),
                };
                context
                    .connection
                    .batch_execute("ROLLBACK")
                    .await
                    .map_err(|rollback| StoreError::RollbackFailed {
                        operation: error.to_string(),
                        rollback,
                    })?;
                if !context.poisoned && context.open_savepoints == 0 {
                    self.connection = Some(context.connection);
                }
                Err(error)
            }
        }
    }
}

impl Context {
    pub fn connection(&mut self) -> &mut Connection {
        &mut self.connection
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

// diesel-async's default adapter otherwise creates a hidden runtime, and its
// cancellation guard uses block_in_place (unsupported on current-thread Tokio).
fn require_runtime() -> Result<(), StoreError> {
    match tokio::runtime::Handle::try_current() {
        Ok(handle) if handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread => {
            Ok(())
        }
        _ => Err(StoreError::UnsupportedRuntime),
    }
}
