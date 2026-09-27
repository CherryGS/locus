use locus_core::api::{CoreError, EntityId};
use locus_store::api::StoreError;
use thiserror::Error;

#[derive(Debug, Error)]
pub(crate) enum PreferenceError {
    #[error(
        "view_definition_id must be nonempty, without surrounding whitespace or control characters"
    )]
    InvalidViewDefinition,
    #[error("revision must be a canonical decimal integer from 1 through 9223372036854775807")]
    InvalidRevision,
    #[error("saved revision exhausted for Entity {0}")]
    RevisionExhausted(EntityId),
    #[error("corrupt preference for Entity {entity}: {message}")]
    CorruptRecord { entity: EntityId, message: String },
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Core(#[from] CoreError),
}

impl From<diesel::result::Error> for PreferenceError {
    fn from(error: diesel::result::Error) -> Self {
        Self::Store(error.into())
    }
}
