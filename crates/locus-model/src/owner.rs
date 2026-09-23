use crate::{
    error::ModelError,
    identity::{MODEL_KIND, ModelId},
    persistence,
    service::ModelService,
};
use locus_core::api::{ComponentId, KindId, KindOwner, OwnerError, OwnerFuture};
use locus_store::api::Context;
pub struct ModelOwner;
impl KindOwner for ModelOwner {
    fn kind(&self) -> KindId {
        MODEL_KIND
    }
    fn exists<'a>(&'a self, c: &'a mut Context, id: ComponentId) -> OwnerFuture<'a, bool> {
        Box::pin(async move {
            match ModelService::read_in(c, ModelId::from_component(id)).await {
                Ok(_) => Ok(true),
                Err(ModelError::MissingRecord(_)) => Ok(false),
                Err(e) => Err(OwnerError::Other(e.to_string())),
            }
        })
    }
    fn delete<'a>(&'a self, c: &'a mut Context, id: ComponentId) -> OwnerFuture<'a, ()> {
        Box::pin(async move {
            persistence::delete(c, ModelId::from_component(id)).await?;
            Ok(())
        })
    }
}
