use locus_store::api::StoreError;
use thiserror::Error;

use crate::{
    identity::{ComponentId, EntityId, IdentityError, KindId},
    owner::OwnerError,
    record::Membership,
};

#[derive(Debug, Error)]
pub enum CoreError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("core database operation failed: {0}")]
    Database(#[from] diesel::result::Error),
    #[error("invalid persisted identity: {0}")]
    Identity(#[from] IdentityError),
    #[error("unsupported core schema version {0}")]
    SchemaVersion(i32),
    #[error("core v1 migration requires resolving shared component {0}")]
    MigrationSharedComponent(ComponentId),
    #[error("component is already attached: {0:?}")]
    AttachmentOccupied(Membership),
    #[error("kind {0} is already registered")]
    DuplicateKind(KindId),
    #[error("kind {0} has no available owner")]
    UnavailableKind(KindId),
    #[error("entity {0} does not exist")]
    MissingEntity(EntityId),
    #[error("component {0} does not exist")]
    MissingComponent(ComponentId),
    #[error("component {component} belongs to {actual}, not {requested}")]
    KindMismatch {
        component: ComponentId,
        actual: KindId,
        requested: KindId,
    },
    #[error("entity/kind slot is occupied by {0}")]
    SlotOccupied(ComponentId),
    #[error("component {0} is still attached")]
    ComponentAttached(ComponentId),
    #[error(transparent)]
    Owner(#[from] OwnerError),
}
