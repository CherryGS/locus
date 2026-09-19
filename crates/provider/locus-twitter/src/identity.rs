use locus_core::api::{ComponentId, IdentityError, KindId};
use uuid::Uuid;

/// Permanently assigned provider kind; independent of Rust names and media format.
pub const TWITTER_KIND: KindId =
    KindId::from_uuid(Uuid::from_u128(0x88ace9d78f024cc68f5badd4dc6faf51));

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct TwitterId(ComponentId);

impl TwitterId {
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
impl std::fmt::Display for TwitterId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}
