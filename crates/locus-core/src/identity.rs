use thiserror::Error;
use uuid::{Uuid, Variant, Version};

#[derive(Debug, Error, PartialEq, Eq)]
pub enum IdentityError {
    #[error("an identity must contain exactly 16 bytes, got {0}")]
    Length(usize),
    #[error("entity and component identities must be RFC UUIDv7")]
    NotUuidV7,
}

fn uuid_from_bytes(bytes: &[u8]) -> Result<Uuid, IdentityError> {
    let bytes: [u8; 16] = bytes
        .try_into()
        .map_err(|_| IdentityError::Length(bytes.len()))?;
    Ok(Uuid::from_bytes(bytes))
}

macro_rules! instance_id {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub struct $name(Uuid);

        impl $name {
            pub fn new() -> Self {
                Self(Uuid::now_v7())
            }
            pub fn from_bytes(bytes: &[u8]) -> Result<Self, IdentityError> {
                let uuid = uuid_from_bytes(bytes)?;
                if uuid.get_version() != Some(Version::SortRand)
                    || uuid.get_variant() != Variant::RFC4122
                {
                    return Err(IdentityError::NotUuidV7);
                }
                Ok(Self(uuid))
            }
            pub fn as_bytes(&self) -> &[u8; 16] {
                self.0.as_bytes()
            }
            pub fn as_uuid(self) -> Uuid {
                self.0
            }
        }
        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }
        impl std::fmt::Display for $name {
            fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                self.0.fmt(formatter)
            }
        }
    };
}

instance_id!(EntityId);
instance_id!(ComponentId);

/// A stable, domain-assigned UUID. Never derive it from a Rust type or crate name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct KindId(Uuid);

impl KindId {
    pub const fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, IdentityError> {
        Ok(Self(uuid_from_bytes(bytes)?))
    }
    pub fn as_bytes(&self) -> &[u8; 16] {
        self.0.as_bytes()
    }
    pub fn as_uuid(self) -> Uuid {
        self.0
    }
}

impl std::fmt::Display for KindId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}
