use std::{collections::HashMap, sync::Arc};

use locus_store::api::Session;

use crate::{error::CoreError, identity::KindId, owner::KindOwner, persistence::schema};

/// Generic identity and membership authority. Registration supplies domain
/// capabilities; it neither creates payload tables nor defines their semantics.
/// Methods ending in `_in` participate in a caller-owned transaction. Other async
/// methods establish and commit their own unit through the supplied session.
#[derive(Clone, Default)]
pub struct Kernel {
    owners: HashMap<KindId, Arc<dyn KindOwner>>,
}

impl Kernel {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, owner: Arc<dyn KindOwner>) -> Result<(), CoreError> {
        let kind = owner.kind();
        if self.owners.contains_key(&kind) {
            return Err(CoreError::DuplicateKind(kind));
        }
        self.owners.insert(kind, owner);
        Ok(())
    }

    pub async fn initialize(&self, session: &mut Session) -> Result<(), CoreError> {
        session
            .transaction(|context| Box::pin(schema::initialize(context)))
            .await
    }

    pub(super) fn owner(&self, kind: KindId) -> Result<&Arc<dyn KindOwner>, CoreError> {
        self.owners
            .get(&kind)
            .ok_or(CoreError::UnavailableKind(kind))
    }
}
