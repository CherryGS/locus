use crate::{identity::FILE_KIND, persistence};
use locus_core::api::{ComponentId, KindId, KindOwner, OwnerError, OwnerFuture};
use locus_store::api::Context;

pub struct FileOwner;
impl KindOwner for FileOwner {
    fn kind(&self) -> KindId {
        FILE_KIND
    }
    fn exists<'a>(
        &'a self,
        context: &'a mut Context,
        component: ComponentId,
    ) -> OwnerFuture<'a, bool> {
        Box::pin(async move { Ok(persistence::exists(context, component).await?) })
    }
    fn delete<'a>(
        &'a self,
        _context: &'a mut Context,
        _component: ComponentId,
    ) -> OwnerFuture<'a, ()> {
        Box::pin(async {
            Err(OwnerError::Veto(
                "File removal effects have not been selected".into(),
            ))
        })
    }
}
