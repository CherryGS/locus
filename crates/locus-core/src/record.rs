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
