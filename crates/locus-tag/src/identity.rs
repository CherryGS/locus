use locus_core::api::{IdentityError, KindId};
use uuid::{Uuid, Variant, Version};
pub const TAG_SET_KIND: KindId =
    KindId::from_uuid(Uuid::from_u128(0x8e880c8bc7dd4d6bb739a6896c716af1));
/// A vocabulary identity, deliberately distinct from Entity and Component IDs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct TagId(Uuid);
impl TagId {
    pub fn new() -> Self {
        Self(Uuid::now_v7())
    }
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, IdentityError> {
        let bytes: [u8; 16] = bytes
            .try_into()
            .map_err(|_| IdentityError::Length(bytes.len()))?;
        let id = Uuid::from_bytes(bytes);
        if id.get_variant() != Variant::RFC4122 || id.get_version() != Some(Version::SortRand) {
            return Err(IdentityError::NotUuidV7);
        }
        Ok(Self(id))
    }
    pub fn as_bytes(&self) -> &[u8; 16] {
        self.0.as_bytes()
    }
}
impl Default for TagId {
    fn default() -> Self {
        Self::new()
    }
}
impl std::fmt::Display for TagId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}
