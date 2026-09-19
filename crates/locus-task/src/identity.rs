use uuid::Uuid;

/// An observation identity, independent of domain entity/component identities.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct TaskId(pub(crate) Uuid);
