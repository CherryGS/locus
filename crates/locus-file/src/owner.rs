use crate::FILE_KIND;
use diesel::{
    QueryableByName, sql_query,
    sql_types::{BigInt, Binary},
};
use diesel_async::RunQueryDsl;
use locus_core::{ComponentId, KindId, KindOwner, OwnerError, OwnerFuture};
use locus_store::Context;

pub struct FileOwner;
#[derive(QueryableByName)]
struct Count {
    #[diesel(sql_type = BigInt)]
    count: i64,
}

impl KindOwner for FileOwner {
    fn kind(&self) -> KindId {
        FILE_KIND
    }
    fn exists<'a>(
        &'a self,
        context: &'a mut Context,
        component: ComponentId,
    ) -> OwnerFuture<'a, bool> {
        Box::pin(async move {
            let row = sql_query("SELECT count(*) AS count FROM locus_files WHERE id = ?")
                .bind::<Binary, _>(component.as_bytes().as_slice())
                .get_result::<Count>(context.connection())
                .await?;
            Ok(row.count == 1)
        })
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
