use locus_store::{Context, TransactionFuture};
use thiserror::Error;

use crate::{ComponentId, KindId};

#[derive(Debug, Error)]
pub enum OwnerError {
    #[error("domain rejected the operation: {0}")]
    Veto(String),
    #[error("domain database operation failed: {0}")]
    Database(#[from] diesel::result::Error),
    #[error("domain operation failed: {0}")]
    Other(String),
}

pub type OwnerFuture<'a, T> = TransactionFuture<'a, T, OwnerError>;

/// The trusted semantic owner of a stable kind. `exists` must check this kind's
/// actual payload table, not merely core metadata. `delete` performs domain
/// validation and payload removal, including domain reference vetoes.
///
/// Both run inside the same supplied write transaction as the kernel's guards.
/// Never commit it, bypass it with another connection, or mutate core metadata.
/// Creation and payload interpretation remain domain APIs. Admitted payloads must
/// be deleted through `Kernel::delete_component` (or its participating variant).
pub trait KindOwner: Send + Sync {
    fn kind(&self) -> KindId;
    fn exists<'a>(
        &'a self,
        context: &'a mut Context,
        component: ComponentId,
    ) -> OwnerFuture<'a, bool>;
    fn delete<'a>(
        &'a self,
        context: &'a mut Context,
        component: ComponentId,
    ) -> OwnerFuture<'a, ()>;
}
