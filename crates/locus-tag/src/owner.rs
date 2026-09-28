use crate::{error::TagError, identity::TAG_SET_KIND, persistence, service::TagService};
use locus_core::api::{ComponentId, KindId, KindOwner, OwnerError, OwnerFuture};
use locus_store::api::Context;
pub struct TagSetOwner;
impl KindOwner for TagSetOwner {
    fn kind(&self) -> KindId {
        TAG_SET_KIND
    }
    fn exists<'a>(&'a self, c: &'a mut Context, id: ComponentId) -> OwnerFuture<'a, bool> {
        Box::pin(async move {
            match TagService::read_set_in(c, id).await {
                Ok(_) => Ok(true),
                Err(TagError::MissingSet) => Ok(false),
                Err(e) => Err(OwnerError::Other(e.to_string())),
            }
        })
    }
    fn delete<'a>(&'a self, c: &'a mut Context, id: ComponentId) -> OwnerFuture<'a, ()> {
        Box::pin(async move {
            persistence::delete_set(c, id).await?;
            Ok(())
        })
    }
}
