use thiserror::Error;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error(transparent)]
    Task(#[from] locus_task::api::TaskError),
    #[error("database identity could not be established: {0}")]
    Identity(#[from] std::io::Error),
    #[error("an entered caller-owned multi-thread Tokio runtime is required")]
    UnsupportedRuntime,
    #[error("could not open SQLite: {0}")]
    Connection(#[from] diesel::ConnectionError),
    #[error("SQLite operation failed: {0}")]
    Database(#[from] diesel::result::Error),
    #[error("the session was discarded; open a new session")]
    Discarded,
    #[error("database path is not valid UTF-8")]
    InvalidPath,
    #[error("commit completion is uncertain; the connection was discarded: {0}")]
    CommitOutcomeUnknown(diesel::result::Error),
    #[error("rollback failed after {operation}; the connection was discarded: {rollback}")]
    RollbackFailed {
        operation: String,
        rollback: diesel::result::Error,
    },
    #[error("transaction cannot commit after a failed savepoint boundary")]
    Poisoned,
}
