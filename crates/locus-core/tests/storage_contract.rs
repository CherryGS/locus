#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use diesel::{
    sql_query,
    sql_types::{BigInt, Binary},
};
use diesel_async::{RunQueryDsl, SimpleAsyncConnection};
use locus_core::{CoreError, IdentityError, Membership};
use locus_store::Session;
use support::domain::*;

#[tokio::test(flavor = "multi_thread")]
async fn persisted_corruption_is_an_error_instead_of_a_different_identity() {
    let mut session = Session::memory().await.unwrap();
    let kernel = fixture(&mut session).await;
    let entity = kernel.create_entity(&mut session).await.unwrap();
    let component = saved_component(&kernel, &mut session, KIND).await;
    session
        .transaction::<_, CoreError, _>(move |context| {
            Box::pin(async move {
                // Emulate an externally damaged file, bypassing the normal storage constraint.
                context
                    .connection()
                    .batch_execute("PRAGMA ignore_check_constraints = ON")
                    .await?;
                sql_query("UPDATE locus_components SET kind = X'01' WHERE id = ?")
                    .bind::<Binary, _>(component.as_bytes().as_slice())
                    .execute(context.connection())
                    .await?;
                context
                    .connection()
                    .batch_execute("PRAGMA ignore_check_constraints = OFF")
                    .await?;
                Ok(())
            })
        })
        .await
        .unwrap();
    assert!(matches!(
        kernel.component_kind(&mut session, component).await,
        Err(CoreError::Identity(IdentityError::Length(1)))
    ));
    session.transaction::<_,CoreError,_>(move |context| Box::pin(async move {
        context.connection().batch_execute("PRAGMA ignore_check_constraints = ON").await?;
        sql_query("INSERT INTO locus_components (id, kind) VALUES (zeroblob(16), ?)").bind::<Binary,_>(KIND.as_bytes().as_slice()).execute(context.connection()).await?;
        sql_query("INSERT INTO locus_memberships (entity, kind, component) VALUES (?, ?, zeroblob(16))")
            .bind::<Binary,_>(entity.as_bytes().as_slice()).bind::<Binary,_>(KIND.as_bytes().as_slice()).execute(context.connection()).await?;
        context.connection().batch_execute("PRAGMA ignore_check_constraints = OFF").await?;
        Ok(())
    })).await.unwrap();
    assert!(matches!(
        kernel.memberships(&mut session, entity).await,
        Err(CoreError::Identity(IdentityError::NotUuidV7))
    ));
}

#[tokio::test(flavor = "multi_thread")]
async fn schema_version_is_core_owned_and_stored_identity_bytes_are_binary16() {
    let mut session = Session::memory().await.unwrap();
    let kernel = fixture(&mut session).await;
    let entity = kernel.create_entity(&mut session).await.unwrap();
    let first = saved_component(&kernel, &mut session, KIND).await;
    let second = saved_component(&kernel, &mut session, OTHER_KIND).await;
    for (kind, component) in [(KIND, first), (OTHER_KIND, second)] {
        kernel
            .attach(
                &mut session,
                Membership {
                    entity,
                    kind,
                    component,
                },
            )
            .await
            .unwrap();
    }
    session
        .transaction::<_, CoreError, _>(|context| {
            Box::pin(async move {
                context
                    .connection()
                    .batch_execute("PRAGMA user_version = 41")
                    .await?;
                Ok(())
            })
        })
        .await
        .unwrap();
    kernel.initialize(&mut session).await.unwrap();
    session.transaction::<_,CoreError,_>(move |context| Box::pin(async move {
        let version = sql_query("SELECT user_version AS count FROM pragma_user_version").get_result::<Count>(context.connection()).await?;
        assert_eq!(version.count, 41);
        let entities = sql_query("SELECT count(*) AS count FROM locus_entities WHERE id = ? AND typeof(id) = 'blob' AND length(id) = 16")
            .bind::<Binary,_>(entity.as_bytes().as_slice()).get_result::<Count>(context.connection()).await?;
        assert_eq!(entities.count, 1);
        let components = sql_query("SELECT count(*) AS count FROM locus_components WHERE typeof(id) = 'blob' AND length(id) = 16 AND typeof(kind) = 'blob' AND length(kind) = 16 AND length(id) = ?")
            .bind::<BigInt,_>(16i64).get_result::<Count>(context.connection()).await?;
        assert_eq!(components.count, 2);
        Ok(())
    })).await.unwrap();
    let memberships = kernel.memberships(&mut session, entity).await.unwrap();
    assert_eq!(memberships.len(), 2);
    assert!(memberships.contains(&Membership {
        entity,
        kind: KIND,
        component: first
    }));
    assert!(memberships.contains(&Membership {
        entity,
        kind: OTHER_KIND,
        component: second
    }));
    assert!(payload_exists(&mut session, first).await);
}
