use locus_core::api::{ComponentId, IdentityError, KindId};
use uuid::Uuid;

/// Assigned identity for the File contract; independent of module/type names.
pub const FILE_KIND: KindId =
    KindId::from_uuid(Uuid::from_u128(0x9fd73d3dd35d41bc8b73402e12f5c017));

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FileId(ComponentId);

impl FileId {
    pub fn from_component(component: ComponentId) -> Self {
        Self(component)
    }
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, IdentityError> {
        Ok(Self(ComponentId::from_bytes(bytes)?))
    }
    pub fn component(self) -> ComponentId {
        self.0
    }
    pub fn as_bytes(&self) -> &[u8; 16] {
        self.0.as_bytes()
    }
    pub(crate) fn fresh() -> Self {
        Self(ComponentId::new())
    }
}

impl std::fmt::Display for FileId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}
