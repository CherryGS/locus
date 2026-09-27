#[derive(Debug, thiserror::Error)]
pub enum SearchError {
    #[error("Invalid search request: {0}")]
    Request(String),
    #[error(transparent)]
    Query(#[from] locus_query::api::QueryError),
    #[error(transparent)]
    Store(#[from] locus_store::api::StoreError),
    #[error(transparent)]
    Core(#[from] locus_core::api::CoreError),
    #[error(transparent)]
    Task(#[from] locus_task::api::TaskError),
    #[error(transparent)]
    Database(#[from] diesel::result::Error),
    #[error(transparent)]
    Engine(#[from] tantivy::TantivyError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("Invalid native query: {0}")]
    Native(String),
    #[error("Search unavailable: {0}")]
    Unavailable(String),
    #[error("Search context unavailable or expired")]
    ContextUnavailable,
    #[error("Invalid search state: {0}")]
    Invalid(String),
}
