use crate::{
    error::TwitterError,
    identity::{TWITTER_KIND, TwitterId},
    persistence,
    service::TwitterService,
};
use locus_core::api::{ComponentId, KindId, KindOwner, OwnerError, OwnerFuture};
use locus_store::api::Context;

pub struct TwitterOwner;
impl KindOwner for TwitterOwner {
    fn kind(&self) -> KindId {
        TWITTER_KIND
    }
    fn exists<'a>(
        &'a self,
        context: &'a mut Context,
        component: ComponentId,
    ) -> OwnerFuture<'a, bool> {
        Box::pin(async move {
            match TwitterService::read_in(context, TwitterId::from_component(component)).await {
                Ok(_) => Ok(true),
                Err(TwitterError::MissingRecord(_)) => Ok(false),
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
            persistence::delete(context, TwitterId::from_component(component)).await?;
            Ok(())
        })
    }
}
