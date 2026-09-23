use locus_core::api::{ComponentId, IdentityError, KindId};
use uuid::Uuid;
pub const MODEL_KIND: KindId =
    KindId::from_uuid(Uuid::from_u128(0x6c46d4eb5c2f46eb9e81f866884e3107));
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ModelId(ComponentId);
impl ModelId {
    pub fn from_component(id: ComponentId) -> Self {
        Self(id)
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
