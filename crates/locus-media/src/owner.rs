use crate::{error::MediaError, identity::MediaKind, persistence, service::MediaService};
use locus_core::api::{ComponentId, KindId, KindOwner, OwnerError, OwnerFuture};
use locus_store::api::Context;

pub struct ImageOwner;
pub struct VideoOwner;
macro_rules! owner {
    ($owner:ident, $kind:ident) => {
        impl KindOwner for $owner {
            fn kind(&self) -> KindId {
                MediaKind::$kind.kind()
            }
            fn exists<'a>(
                &'a self,
                context: &'a mut Context,
                component: ComponentId,
            ) -> OwnerFuture<'a, bool> {
                Box::pin(async move {
                    match MediaService::read_in(context, MediaKind::$kind.id(component)).await {
                        Ok(_) => Ok(true),
                        Err(MediaError::MissingRecord(_)) => Ok(false),
                        Err(e) => Err(OwnerError::Other(e.to_string())),
                    }
                })
            }
            fn delete<'a>(
                &'a self,
                context: &'a mut Context,
                component: ComponentId,
            ) -> OwnerFuture<'a, ()> {
                Box::pin(async move {
                    persistence::delete(context, MediaKind::$kind.id(component)).await?;
                    Ok(())
                })
            }
        }
    };
}
owner!(ImageOwner, Image);
owner!(VideoOwner, Video);
