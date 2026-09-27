#[derive(Debug, thiserror::Error)]
pub enum QueryError {
    #[error("Invalid query: {0}")]
    Invalid(String),
    #[error("Projection failed: {0}")]
    Projection(String),
    #[error(transparent)]
    Store(#[from] locus_store::api::StoreError),
}
