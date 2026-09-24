use crate::{
    error::BilibiliError,
    identity::{BILIBILI_KIND, BilibiliId},
    persistence,
    service::BilibiliService,
};
use locus_core::api::{ComponentId, KindId, KindOwner, OwnerError, OwnerFuture};
use locus_store::api::Context;

pub struct BilibiliOwner;
impl KindOwner for BilibiliOwner {
    fn kind(&self) -> KindId {
        BILIBILI_KIND
    }
    fn exists<'a>(
        &'a self,
        context: &'a mut Context,
        component: ComponentId,
    ) -> OwnerFuture<'a, bool> {
        Box::pin(async move {
            match BilibiliService::read_in(context, BilibiliId::from_component(component)).await {
                Ok(_) => Ok(true),
                Err(BilibiliError::MissingRecord(_)) => Ok(false),
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
            persistence::delete(context, BilibiliId::from_component(component)).await?;
            Ok(())
        })
    }
}
