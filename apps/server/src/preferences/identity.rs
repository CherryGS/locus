use super::error::PreferenceError;

/// A retained definition identity, independent of this build's supported views.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ViewDefinitionId(String);

impl ViewDefinitionId {
    pub fn new(value: String) -> Result<Self, PreferenceError> {
        if value.is_empty() || value.trim() != value || value.chars().any(char::is_control) {
            return Err(PreferenceError::InvalidViewDefinition);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Provider version identity retained as presentation provenance.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CivitaiVersionId(String);

impl CivitaiVersionId {
    pub fn new(value: String) -> Result<Self, PreferenceError> {
        if value.is_empty() || value.trim() != value || value.chars().any(char::is_control) {
            return Err(PreferenceError::InvalidCoverVersion);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SavedRevision(i64);

impl SavedRevision {
    pub fn from_decimal(value: &str) -> Result<Self, PreferenceError> {
        let revision = value
            .parse::<i64>()
            .map_err(|_| PreferenceError::InvalidRevision)?;
        if revision.to_string() != value {
            return Err(PreferenceError::InvalidRevision);
        }
        Self::new(revision)
    }

    pub fn new(value: i64) -> Result<Self, PreferenceError> {
        if value <= 0 {
            return Err(PreferenceError::InvalidRevision);
        }
        Ok(Self(value))
    }

    pub fn value(self) -> i64 {
        self.0
    }
}
