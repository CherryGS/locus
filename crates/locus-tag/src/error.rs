use thiserror::Error;
#[derive(Debug, Error)]
pub enum TagError {
    #[error("Tag name must not be blank")]
    BlankName,
    #[error("A Tag already has this exact name (names are case-sensitive)")]
    DuplicateName,
    #[error("Tag record is missing")]
    MissingTag,
    #[error("Tag-set record is missing")]
    MissingSet,
    #[error("Tag changed since the displayed observation; reread before editing")]
    Conflict,
    #[error("Invalid Tag data: {0}")]
    Corrupt(String),
    #[error(transparent)]
    Store(#[from] locus_store::api::StoreError),
    #[error(transparent)]
    Core(#[from] locus_core::api::CoreError),
    #[error(transparent)]
    Database(#[from] diesel::result::Error),
    #[error(transparent)]
    Identity(#[from] locus_core::api::IdentityError),
}
