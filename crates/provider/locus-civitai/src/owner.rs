use crate::{
    error::CivitaiError,
    identity::{CIVITAI_KIND, CivitaiId},
    persistence,
    service::CivitaiService,
};
use locus_core::api::{ComponentId, KindId, KindOwner, OwnerError, OwnerFuture};
use locus_store::api::Context;

pub struct CivitaiOwner;
impl KindOwner for CivitaiOwner {
    fn kind(&self) -> KindId {
        CIVITAI_KIND
    }
    fn exists<'a>(
        &'a self,
        context: &'a mut Context,
        component: ComponentId,
    ) -> OwnerFuture<'a, bool> {
        Box::pin(async move {
            match CivitaiService::read_in(context, CivitaiId::from_component(component)).await {
                Ok(_) => Ok(true),
                Err(CivitaiError::MissingRecord(_)) => Ok(false),
                Err(error) => Err(OwnerError::Other(error.to_string())),
            }
        })
    }
    fn delete<'a>(
        &'a self,
        context: &'a mut Context,
        component: ComponentId,
    ) -> OwnerFuture<'a, ()> {
        Box::pin(async move {
            persistence::delete(context, CivitaiId::from_component(component)).await?;
            Ok(())
        })
    }
}
