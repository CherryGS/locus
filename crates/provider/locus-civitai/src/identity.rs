use locus_core::api::{ComponentId, IdentityError, KindId};
use uuid::Uuid;

/// Permanently assigned provider kind; independent of Rust names and media format.
pub const CIVITAI_KIND: KindId =
    KindId::from_uuid(Uuid::from_u128(0xc42c90cbb7ce47f7a42e9d82f44b103a));

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct CivitaiId(ComponentId);

impl CivitaiId {
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
}
impl std::fmt::Display for CivitaiId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}
