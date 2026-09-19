use thiserror::Error;

#[derive(Debug, Error)]
pub enum TaskError {
    #[error("a caller-owned Tokio runtime is required")]
    NoRuntime,
    #[error("resource belongs to another task coordinator")]
    ForeignResource,
    #[error("a task cannot acquire a stage while another stage is pending or active")]
    NestedStage,
    #[error("task body has ended")]
    Closed,
    #[error("task or worker failed: {0}")]
    Worker(String),
}
