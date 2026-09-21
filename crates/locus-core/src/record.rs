use crate::identity::{ComponentId, EntityId, KindId};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachOutcome {
    Attached,
    AlreadyAttached,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Membership {
    pub entity: EntityId,
    pub kind: KindId,
    pub component: ComponentId,
}

/// Packed, validated RFC UUIDv7 bytes owned by one completed enumeration.
/// Later database changes do not revise this result. No order across reads is promised.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntityIds {
    bytes: Vec<u8>,
}

impl EntityIds {
    pub(crate) fn from_validated_bytes(bytes: Vec<u8>) -> Self {
        Self { bytes }
    }
    pub fn len(&self) -> usize {
        self.bytes.len() / 16
    }
    pub fn is_empty(&self) -> bool {
        self.bytes.is_empty()
    }
    pub fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }
    pub fn into_bytes(self) -> Vec<u8> {
        self.bytes
    }
}

/// An attributed membership observation. None means missing Entity; Some(empty)
/// means a present Entity without memberships. Payload/owner availability is irrelevant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntityMemberships {
    pub entity: EntityId,
    pub memberships: Option<Vec<Membership>>,
}
