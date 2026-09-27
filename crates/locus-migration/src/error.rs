use thiserror::Error;

#[derive(Debug, Error)]
pub enum MigrationError {
    #[error(transparent)]
    Store(#[from] locus_store::api::StoreError),
    #[error("migration database operation failed: {0}")]
    Database(#[from] diesel::result::Error),
    #[error("incompatible migration history: {0}")]
    Incompatible(String),
    #[error("migration history phase failed: {0}")]
    History(#[source] Box<MigrationError>),
    #[error("migration step {id} ({name}) failed: {source}")]
    Step {
        id: i64,
        name: &'static str,
        #[source]
        source: Box<MigrationError>,
    },
}
