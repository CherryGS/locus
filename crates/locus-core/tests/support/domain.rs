use diesel::{
    QueryableByName, sql_query,
    sql_types::{BigInt, Binary, Integer},
};
use diesel_async::{RunQueryDsl, SimpleAsyncConnection};
use locus_core::api::{ComponentId, CoreError, Kernel, KindId, KindOwner, OwnerError, OwnerFuture};
use locus_store::api::{Context, Session};
use std::sync::Arc;
use uuid::Uuid;

pub const KIND: KindId = KindId::from_uuid(Uuid::from_u128(0x92d773fda882478ba885b2d6a6c9db14));
pub const OTHER_KIND: KindId =
    KindId::from_uuid(Uuid::from_u128(0x583a0d8b23d64c5daf8e62b4e7a10245));

#[derive(QueryableByName)]
pub struct Count {
    #[diesel(sql_type = BigInt)]
    pub count: i64,
}
#[derive(QueryableByName)]
struct PayloadState {
    #[diesel(sql_type = Integer)]
    protected: i32,
    #[diesel(sql_type = Integer)]
    fail_after_delete: i32,
}

pub struct PayloadOwner(pub KindId);
impl KindOwner for PayloadOwner {
    fn kind(&self) -> KindId {
        self.0
    }
    fn exists<'a>(
        &'a self,
        context: &'a mut Context,
        component: ComponentId,
    ) -> OwnerFuture<'a, bool> {
        Box::pin(async move {
            let count =
                sql_query("SELECT count(*) AS count FROM test_payloads WHERE id = ? AND kind = ?")
                    .bind::<Binary, _>(component.as_bytes().as_slice())
                    .bind::<Binary, _>(self.0.as_bytes().as_slice())
                    .get_result::<Count>(context.connection())
                    .await?;
            Ok(count.count == 1)
        })
    }
    fn delete<'a>(
        &'a self,
        context: &'a mut Context,
        component: ComponentId,
    ) -> OwnerFuture<'a, ()> {
        Box::pin(async move {
            let state = sql_query(
                "SELECT protected, fail_after_delete FROM test_payloads WHERE id = ? AND kind = ?",
            )
            .bind::<Binary, _>(component.as_bytes().as_slice())
            .bind::<Binary, _>(self.0.as_bytes().as_slice())
            .get_result::<PayloadState>(context.connection())
            .await?;
            if state.protected != 0 {
                return Err(OwnerError::Veto(
                    "domain reference prevents deletion".into(),
                ));
            }
            sql_query("DELETE FROM test_payloads WHERE id = ? AND kind = ?")
                .bind::<Binary, _>(component.as_bytes().as_slice())
                .bind::<Binary, _>(self.0.as_bytes().as_slice())
                .execute(context.connection())
                .await?;
            if state.fail_after_delete != 0 {
                return Err(OwnerError::Other("domain failed after its write".into()));
            }
            Ok(())
        })
    }
}

pub async fn fixture(session: &mut Session) -> Kernel {
    let mut kernel = Kernel::new();
    kernel.register(Arc::new(PayloadOwner(KIND))).unwrap();
    kernel.register(Arc::new(PayloadOwner(OTHER_KIND))).unwrap();
    locus_migration::api::migrate(session).await.unwrap();
    session.transaction::<_, CoreError,_>(|context| Box::pin(async move {
        context.connection().batch_execute("CREATE TABLE test_payloads (id BLOB PRIMARY KEY NOT NULL, kind BLOB NOT NULL, value TEXT NOT NULL, protected INTEGER NOT NULL DEFAULT 0, fail_after_delete INTEGER NOT NULL DEFAULT 0)").await?;
        Ok(())
    })).await.unwrap();
    kernel
}

pub async fn create_payload(
    context: &mut Context,
    component: ComponentId,
    kind: KindId,
) -> Result<(), CoreError> {
    sql_query("INSERT INTO test_payloads (id, kind, value) VALUES (?, ?, 'domain value')")
        .bind::<Binary, _>(component.as_bytes().as_slice())
        .bind::<Binary, _>(kind.as_bytes().as_slice())
        .execute(context.connection())
        .await?;
    Ok(())
}

pub async fn saved_component(kernel: &Kernel, session: &mut Session, kind: KindId) -> ComponentId {
    let component = ComponentId::new();
    let kernel = kernel.clone();
    session
        .transaction::<_, CoreError, _>(move |context| {
            Box::pin(async move {
                create_payload(context, component, kind).await?;
                kernel.admit_component_in(context, kind, component).await
            })
        })
        .await
        .unwrap();
    component
}

pub async fn payload_exists(session: &mut Session, component: ComponentId) -> bool {
    session
        .transaction::<_, CoreError, _>(move |context| {
            Box::pin(async move {
                let row = sql_query("SELECT count(*) AS count FROM test_payloads WHERE id = ?")
                    .bind::<Binary, _>(component.as_bytes().as_slice())
                    .get_result::<Count>(context.connection())
                    .await?;
                Ok(row.count == 1)
            })
        })
        .await
        .unwrap()
}
