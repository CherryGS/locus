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
    #[error("unsupported payload version: {0}")]
    Unsupported(i64),
    #[error("corrupt settings schema: {0}")]
    CorruptSchema(String),
    #[error("unsupported settings schema version: {0}")]
    SchemaVersion(i64),
}
impl From<diesel::result::Error> for SettingsError {
    fn from(value: diesel::result::Error) -> Self {
        Self::Store(value.into())
    }
}
