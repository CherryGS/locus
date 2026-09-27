#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use diesel_async::SimpleAsyncConnection;
use locus_core::api::{CoreError, EntityId, EntityMemberships, Kernel, Membership};
use locus_store::api::Session;
use support::domain::*;

#[tokio::test(flavor = "multi_thread")]
async fn complete_binary_observations_are_fixed_and_exclude_unattached_components() {
    let mut session = Session::memory().await.unwrap();
    let kernel = fixture(&mut session).await;
    assert!(kernel.entity_ids(&mut session).await.unwrap().is_empty());
    let first = kernel.create_entity(&mut session).await.unwrap();
    let empty = kernel.create_entity(&mut session).await.unwrap();
    let component = saved_component(&kernel, &mut session, KIND).await;
    assert!(payload_exists(&mut session, component).await);
    let prior = kernel.entity_ids(&mut session).await.unwrap();
    assert_eq!(prior.len(), 2);
    let ids: std::collections::HashSet<_> = prior
        .as_bytes()
        .chunks_exact(16)
        .map(|id| EntityId::from_bytes(id).unwrap())
        .collect();
    assert_eq!(ids, [first, empty].into());
    assert!(
        !prior
            .as_bytes()
            .chunks_exact(16)
            .any(|id| id == component.as_bytes())
    );
    kernel.delete_entity(&mut session, first).await.unwrap();
    let next = kernel.create_entity(&mut session).await.unwrap();
    let refreshed = kernel.entity_ids(&mut session).await.unwrap();
    assert_eq!(refreshed.len(), 2);
    assert!(
        refreshed
            .as_bytes()
            .chunks_exact(16)
            .any(|id| id == next.as_bytes())
    );
    assert!(
        prior
            .as_bytes()
            .chunks_exact(16)
            .any(|id| id == first.as_bytes())
    );
    assert!(
        !prior
            .as_bytes()
            .chunks_exact(16)
            .any(|id| id == next.as_bytes())
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn batch_attribution_duplicates_chunking_and_owner_independence() {
    let mut session = Session::memory().await.unwrap();
    let kernel = fixture(&mut session).await;
    let empty = kernel.create_entity(&mut session).await.unwrap();
    let mounted = kernel.create_entity(&mut session).await.unwrap();
    let component = saved_component(&kernel, &mut session, KIND).await;
    let membership = Membership {
        entity: mounted,
        kind: KIND,
        component,
    };
    kernel.attach(&mut session, membership).await.unwrap();
    let missing = EntityId::new();
    let mut inputs: Vec<_> = (0..1001).map(|_| EntityId::new()).collect();
    inputs[0] = mounted;
    inputs[499] = empty;
    inputs[500] = mounted;
    inputs[999] = missing;
    inputs[1000] = mounted;
    // No kind owner registered on this consumer, even though memberships exist.
    let reader = Kernel::new();
    let rows = reader
        .memberships_batch(&mut session, &inputs)
        .await
        .unwrap();
    assert_eq!(rows.len(), inputs.len());
    for (index, row) in rows.iter().enumerate() {
        assert_eq!(row.entity, inputs[index]);
        assert_eq!(
            row.memberships,
            if inputs[index] == mounted {
                Some(vec![membership])
            } else if inputs[index] == empty {
                Some(vec![])
            } else {
                None
            }
        );
    }
    assert!(
        reader
            .memberships_batch(&mut session, &[])
            .await
            .unwrap()
            .is_empty()
    );
    kernel.detach(&mut session, membership).await.unwrap();
    kernel.delete_entity(&mut session, empty).await.unwrap();
    assert_eq!(
        reader
            .memberships_batch(&mut session, &[mounted, empty])
            .await
            .unwrap(),
        vec![
            EntityMemberships {
                entity: mounted,
                memberships: Some(vec![])
            },
            EntityMemberships {
                entity: empty,
                memberships: None
            },
        ]
    );
    assert_eq!(rows[0].memberships, Some(vec![membership]));
    // Transaction participants observe the caller's own changes, without nesting.
    session
        .transaction::<_, CoreError, _>(move |context| {
            Box::pin(async move {
                let created = reader.create_entity_in(context).await?;
                assert_eq!(reader.entity_ids_in(context).await?.len(), 2);
                assert_eq!(
                    reader.memberships_batch_in(context, &[created]).await?[0].memberships,
                    Some(vec![])
                );
                Ok(())
            })
        })
        .await
        .unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn corrupt_identity_or_query_failure_cannot_publish_partial_success() {
    let mut session = Session::memory().await.unwrap();
    let kernel = fixture(&mut session).await;
    kernel.create_entity(&mut session).await.unwrap();
    session.transaction::<_, CoreError, _>(|context| Box::pin(async move {
        context.connection().batch_execute("PRAGMA ignore_check_constraints = ON; INSERT INTO locus_core_comm_entity VALUES (zeroblob(16));").await?;
        Ok(())
    })).await.unwrap();
    assert!(matches!(
        kernel.entity_ids(&mut session).await,
        Err(CoreError::Identity(_))
    ));
    session
        .transaction::<_, CoreError, _>(|context| {
            Box::pin(async move {
                context
                    .connection()
                    .batch_execute("DROP TABLE locus_core_rela_membership;")
                    .await?;
                Ok(())
            })
        })
        .await
        .unwrap();
    assert!(matches!(
        kernel
            .memberships_batch(&mut session, &[EntityId::new()])
            .await,
        Err(CoreError::Database(_))
    ));
}
