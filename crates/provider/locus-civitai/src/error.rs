use crate::identity::CivitaiId;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CivitaiError {
    #[error(transparent)]
    Store(#[from] locus_store::api::StoreError),
    #[error(transparent)]
    Core(#[from] locus_core::api::CoreError),
    #[error(transparent)]
    File(#[from] locus_file::api::FileError),
    #[error(transparent)]
    Media(#[from] locus_media::api::MediaError),
    #[error(transparent)]
    Task(#[from] locus_task::api::TaskError),
    #[error("Civitai database: {0}")]
    Database(#[from] diesel::result::Error),
    #[error("Civitai record {0} is missing")]
    MissingRecord(CivitaiId),
    #[error("Invalid Civitai observation: {0}")]
    Invalid(String),
    #[error("Civitai acquisition failed: {0}")]
    Acquisition(String),
    #[error("The intended Civitai observation, host, File or component changed")]
    Conflict,
    #[error("Civitai I/O: {0}")]
    Io(#[from] std::io::Error),
    #[error("Civitai worker: {0}")]
    Worker(String),
}
