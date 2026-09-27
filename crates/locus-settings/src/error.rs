#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error(transparent)]
    Store(#[from] locus_store::api::StoreError),
    #[error("duplicate settings identity: {0}")]
    Duplicate(uuid::Uuid),
    #[error("settings provider unavailable: {0}")]
    Unavailable(uuid::Uuid),
    #[error("invalid settings value: {0}")]
    Invalid(String),
}
impl From<diesel::result::Error> for SettingsError {
    fn from(value: diesel::result::Error) -> Self {
        Self::Store(value.into())
    }
}
