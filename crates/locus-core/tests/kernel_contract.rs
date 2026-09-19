#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use diesel::{sql_query, sql_types::Binary};
use diesel_async::{RunQueryDsl, SimpleAsyncConnection};
use locus_core::{
    AttachOutcome, ComponentId, CoreError, EntityId, IdentityError, Kernel, KindId, Membership,
    OwnerError,
};
use locus_store::{Session, StoreError};
use std::{future::pending, sync::Arc, time::Duration};
use support::domain::*;
use tokio::{sync::oneshot, time::timeout};

#[test]
fn identity_round_trips_preserve_bytes_and_reject_invalid_instances() {
    let entity = EntityId::new();
    let component = ComponentId::new();
    assert_eq!(EntityId::from_bytes(entity.as_bytes()).unwrap(), entity);
    assert_eq!(
        ComponentId::from_bytes(component.as_bytes()).unwrap(),
        component
    );
    assert_eq!(KindId::from_bytes(KIND.as_bytes()).unwrap(), KIND);
    assert_ne!(entity.as_bytes(), component.as_bytes());
    assert_eq!(
        EntityId::from_bytes(&[0; 15]),
        Err(IdentityError::Length(15))
    );
    assert_eq!(
        ComponentId::from_bytes(&[0; 16]),
        Err(IdentityError::NotUuidV7)
    );
    let mut wrong_version = *entity.as_bytes();
    wrong_version[6] = 0x40;
    assert_eq!(
        EntityId::from_bytes(&wrong_version),
        Err(IdentityError::NotUuidV7)
    );
    let mut wrong_variant = *component.as_bytes();
    wrong_variant[8] = 0;
    assert_eq!(
        ComponentId::from_bytes(&wrong_variant),
        Err(IdentityError::NotUuidV7)
    );
    assert_eq!(KindId::from_bytes(&[0; 17]), Err(IdentityError::Length(17)));
}

#[tokio::test(flavor = "multi_thread")]
async fn shared_lifecycle_retains_payload_and_exact_detach_does_not_replace() {
    let mut session = Session::memory().await.unwrap();
    let kernel = fixture(&mut session).await;
    let first = kernel.create_entity(&mut session).await.unwrap();
    let second = kernel.create_entity(&mut session).await.unwrap();
    let component = saved_component(&kernel, &mut session, KIND).await;
    let replacement = saved_component(&kernel, &mut session, KIND).await;
    let a = Membership {
        entity: first,
        kind: KIND,
        component,
    };
    let b = Membership {
        entity: second,
        ..a
    };
    assert!(
        kernel
            .memberships(&mut session, first)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        kernel.attach(&mut session, a).await.unwrap(),
        AttachOutcome::Attached
    );
    assert_eq!(
        kernel.attach(&mut session, a).await.unwrap(),
        AttachOutcome::AlreadyAttached
    );
    kernel.attach(&mut session, b).await.unwrap();
    assert_eq!(
        kernel.memberships(&mut session, first).await.unwrap(),
        vec![a]
    );
    assert!(
        matches!(kernel.attach(&mut session, Membership { component: replacement, ..a }).await, Err(CoreError::SlotOccupied(id)) if id == component)
    );
    assert!(
        matches!(kernel.delete_component(&mut session, KIND, component).await, Err(CoreError::ComponentAttached(id)) if id == component)
    );
    assert!(payload_exists(&mut session, component).await);
    assert!(kernel.detach(&mut session, a).await.unwrap());
    assert!(payload_exists(&mut session, component).await);
    let replaced = Membership {
        component: replacement,
        ..a
    };
    kernel.attach(&mut session, replaced).await.unwrap();
    assert!(!kernel.detach(&mut session, a).await.unwrap());
    assert_eq!(
        kernel.memberships(&mut session, first).await.unwrap(),
        vec![replaced]
    );
    kernel.delete_entity(&mut session, first).await.unwrap();
    assert!(payload_exists(&mut session, replacement).await);
    assert_eq!(
        kernel.memberships(&mut session, second).await.unwrap(),
        vec![b]
    );
    assert!(kernel.detach(&mut session, b).await.unwrap());
    assert!(payload_exists(&mut session, component).await);
    kernel
        .delete_component(&mut session, KIND, component)
        .await
        .unwrap();
    assert!(!payload_exists(&mut session, component).await);
    assert!(matches!(
        kernel.component_kind(&mut session, component).await,
        Err(CoreError::MissingComponent(_))
    ));
    assert!(kernel.entity_exists(&mut session, second).await.unwrap());
}

#[tokio::test(flavor = "multi_thread")]
async fn entity_deletion_keeps_shared_and_last_link_payloads() {
    let mut session = Session::memory().await.unwrap();
    let kernel = fixture(&mut session).await;
    let first = kernel.create_entity(&mut session).await.unwrap();
    let second = kernel.create_entity(&mut session).await.unwrap();
    let component = saved_component(&kernel, &mut session, KIND).await;
    let first_link = Membership {
        entity: first,
        kind: KIND,
        component,
    };
    let second_link = Membership {
        entity: second,
        ..first_link
    };
    kernel.attach(&mut session, first_link).await.unwrap();
    kernel.attach(&mut session, second_link).await.unwrap();
    kernel.delete_entity(&mut session, first).await.unwrap();
    assert_eq!(
        kernel.memberships(&mut session, second).await.unwrap(),
        vec![second_link]
    );
    assert!(payload_exists(&mut session, component).await);
    kernel.delete_entity(&mut session, second).await.unwrap();
    assert!(payload_exists(&mut session, component).await);
    assert_eq!(
        kernel
            .component_kind(&mut session, component)
            .await
            .unwrap(),
        KIND
    );
    assert!(matches!(
        kernel.memberships(&mut session, first).await,
        Err(CoreError::MissingEntity(_))
    ));
}

#[tokio::test(flavor = "multi_thread")]
async fn admission_and_attachment_use_real_owner_evidence_and_explicit_prerequisites() {
    let mut session = Session::memory().await.unwrap();
    let mut kernel = fixture(&mut session).await;
    assert!(matches!(
        kernel.register(Arc::new(PayloadOwner(KIND))),
        Err(CoreError::DuplicateKind(_))
    ));
    let entity = kernel.create_entity(&mut session).await.unwrap();
    let absent = ComponentId::new();
    assert!(matches!(
        kernel.admit_component(&mut session, KIND, absent).await,
        Err(CoreError::MissingComponent(_))
    ));
    let other = saved_component(&kernel, &mut session, OTHER_KIND).await;
    assert!(matches!(
        kernel.admit_component(&mut session, KIND, other).await,
        Err(CoreError::KindMismatch { .. })
    ));
    assert!(matches!(
        kernel
            .attach(
                &mut session,
                Membership {
                    entity,
                    kind: KIND,
                    component: other
                }
            )
            .await,
        Err(CoreError::KindMismatch { .. })
    ));
    let fresh = ComponentId::new();
    session
        .transaction::<_, CoreError, _>(move |context| {
            Box::pin(create_payload(context, fresh, OTHER_KIND))
        })
        .await
        .unwrap();
    assert!(matches!(
        kernel.admit_component(&mut session, KIND, fresh).await,
        Err(CoreError::MissingComponent(_))
    ));
    let component = saved_component(&kernel, &mut session, KIND).await;
    kernel
        .admit_component(&mut session, KIND, component)
        .await
        .unwrap();
    let link = Membership {
        entity,
        kind: KIND,
        component,
    };
    assert!(matches!(
        kernel
            .attach(
                &mut session,
                Membership {
                    entity: EntityId::new(),
                    ..link
                }
            )
            .await,
        Err(CoreError::MissingEntity(_))
    ));
    assert!(matches!(
        kernel
            .attach(
                &mut session,
                Membership {
                    component: absent,
                    ..link
                }
            )
            .await,
        Err(CoreError::MissingComponent(_))
    ));
    assert!(matches!(
        Kernel::new().attach(&mut session, link).await,
        Err(CoreError::UnavailableKind(_))
    ));
    kernel.attach(&mut session, link).await.unwrap();
    assert_eq!(
        Kernel::new()
            .memberships(&mut session, entity)
            .await
            .unwrap(),
        vec![link]
    );
    kernel.detach(&mut session, link).await.unwrap();
    // Simulate out-of-contract owner damage: metadata alone must never admit a link.
    session
        .transaction::<_, CoreError, _>(move |context| {
            Box::pin(async move {
                sql_query("DELETE FROM test_payloads WHERE id = ?")
                    .bind::<Binary, _>(component.as_bytes().as_slice())
                    .execute(context.connection())
                    .await?;
                Ok(())
            })
        })
        .await
        .unwrap();
    assert!(matches!(
        kernel.attach(&mut session, link).await,
        Err(CoreError::MissingComponent(_))
    ));
    assert!(matches!(
        kernel.delete_component(&mut session, KIND, component).await,
        Err(CoreError::MissingComponent(_))
    ));
}

#[tokio::test(flavor = "multi_thread")]
async fn domain_veto_and_mid_delete_error_preserve_metadata_and_payload_even_when_caught() {
    let mut session = Session::memory().await.unwrap();
    let kernel = fixture(&mut session).await;
    let vetoed = saved_component(&kernel, &mut session, KIND).await;
    let failing = saved_component(&kernel, &mut session, KIND).await;
    session
        .transaction::<_, CoreError, _>(move |context| {
            Box::pin(async move {
                sql_query("UPDATE test_payloads SET protected = 1 WHERE id = ?")
                    .bind::<Binary, _>(vetoed.as_bytes().as_slice())
                    .execute(context.connection())
                    .await?;
                sql_query("UPDATE test_payloads SET fail_after_delete = 1 WHERE id = ?")
                    .bind::<Binary, _>(failing.as_bytes().as_slice())
                    .execute(context.connection())
                    .await?;
                Ok(())
            })
        })
        .await
        .unwrap();
    assert!(matches!(
        kernel.delete_component(&mut session, KIND, vetoed).await,
        Err(CoreError::Owner(OwnerError::Veto(_)))
    ));
    let participant = kernel.clone();
    let unrelated = session
        .transaction::<_, CoreError, _>(move |context| {
            Box::pin(async move {
                let failure = participant
                    .delete_component_in(context, KIND, failing)
                    .await;
                assert!(matches!(
                    failure,
                    Err(CoreError::Owner(OwnerError::Other(_)))
                ));
                participant.create_entity_in(context).await
            })
        })
        .await
        .unwrap();
    assert!(kernel.entity_exists(&mut session, unrelated).await.unwrap());
    for component in [vetoed, failing] {
        assert!(payload_exists(&mut session, component).await);
        assert_eq!(
            kernel
                .component_kind(&mut session, component)
                .await
                .unwrap(),
            KIND
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn independent_commits_survive_later_failure_but_natural_group_rolls_back() {
    let mut session = Session::memory().await.unwrap();
    let kernel = fixture(&mut session).await;
    let entity = kernel.create_entity(&mut session).await.unwrap();
    let component = saved_component(&kernel, &mut session, KIND).await;
    let failed = kernel
        .attach(
            &mut session,
            Membership {
                entity: EntityId::new(),
                kind: KIND,
                component,
            },
        )
        .await;
    assert!(matches!(failed, Err(CoreError::MissingEntity(_))));
    assert!(kernel.entity_exists(&mut session, entity).await.unwrap());
    assert!(payload_exists(&mut session, component).await);
    assert!(
        kernel
            .memberships(&mut session, entity)
            .await
            .unwrap()
            .is_empty()
    );
    let grouped = ComponentId::new();
    let (created, identity) = oneshot::channel();
    let participant = kernel.clone();
    let failed = session
        .transaction::<_, CoreError, _>(move |context| {
            Box::pin(async move {
                let entity = participant.create_entity_in(context).await?;
                created.send(entity).unwrap();
                create_payload(context, grouped, KIND).await?;
                participant
                    .admit_component_in(context, KIND, grouped)
                    .await?;
                let link = Membership {
                    entity,
                    kind: KIND,
                    component: grouped,
                };
                participant.attach_in(context, link).await?;
                participant
                    .attach_in(context, Membership { component, ..link })
                    .await?;
                Ok(())
            })
        })
        .await;
    assert!(matches!(failed, Err(CoreError::SlotOccupied(_))));
    let grouped_entity = identity.await.unwrap();
    assert!(
        !kernel
            .entity_exists(&mut session, grouped_entity)
            .await
            .unwrap()
    );
    assert!(!payload_exists(&mut session, grouped).await);
    assert!(matches!(
        kernel.component_kind(&mut session, grouped).await,
        Err(CoreError::MissingComponent(_))
    ));
    assert!(kernel.entity_exists(&mut session, entity).await.unwrap());
    assert!(payload_exists(&mut session, component).await);
}

#[tokio::test(flavor = "multi_thread")]
async fn canceled_real_payload_group_is_discarded_before_commit_and_prior_rows_reopen() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("cancel.sqlite");
    let mut session = Session::open(&path).await.unwrap();
    let kernel = fixture(&mut session).await;
    let prior_entity = kernel.create_entity(&mut session).await.unwrap();
    let prior_component = saved_component(&kernel, &mut session, KIND).await;
    let grouped = ComponentId::new();
    let participant = kernel.clone();
    let (created, ready) = oneshot::channel();
    let grouped_entity;
    {
        let transaction = session.transaction::<(), CoreError, _>(move |context| {
            Box::pin(async move {
                let entity = participant.create_entity_in(context).await?;
                create_payload(context, grouped, KIND).await?;
                participant
                    .admit_component_in(context, KIND, grouped)
                    .await?;
                participant
                    .attach_in(
                        context,
                        Membership {
                            entity,
                            kind: KIND,
                            component: grouped,
                        },
                    )
                    .await?;
                created.send(entity).unwrap();
                pending().await
            })
        });
        tokio::pin!(transaction);
        grouped_entity = timeout(Duration::from_secs(5), async {
            tokio::select! {
                result = &mut transaction => panic!("transaction unexpectedly completed: {result:?}"),
                entity = ready => entity.unwrap(),
            }
        }).await.unwrap();
    }
    assert!(!session.is_usable());
    assert!(matches!(
        kernel.create_entity(&mut session).await,
        Err(CoreError::Store(StoreError::Discarded))
    ));
    let mut reopened = Session::open(&path).await.unwrap();
    kernel.initialize(&mut reopened).await.unwrap();
    assert!(
        !kernel
            .entity_exists(&mut reopened, grouped_entity)
            .await
            .unwrap()
    );
    assert!(!payload_exists(&mut reopened, grouped).await);
    assert!(matches!(
        kernel.component_kind(&mut reopened, grouped).await,
        Err(CoreError::MissingComponent(_))
    ));
    assert!(
        kernel
            .entity_exists(&mut reopened, prior_entity)
            .await
            .unwrap()
    );
    assert!(payload_exists(&mut reopened, prior_component).await);
}

#[tokio::test(flavor = "multi_thread")]
async fn durable_reopen_schema_version_and_binary_constraints_are_checked() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("persistent.sqlite");
    let mut session = Session::open(&path).await.unwrap();
    let kernel = fixture(&mut session).await;
    let entity = kernel.create_entity(&mut session).await.unwrap();
    let component = saved_component(&kernel, &mut session, KIND).await;
    let link = Membership {
        entity,
        kind: KIND,
        component,
    };
    kernel.attach(&mut session, link).await.unwrap();
    drop(session);
    let mut reopened = Session::open(&path).await.unwrap();
    kernel.initialize(&mut reopened).await.unwrap();
    assert_eq!(
        kernel.memberships(&mut reopened, entity).await.unwrap(),
        vec![link]
    );
    assert!(payload_exists(&mut reopened, component).await);
    for statement in [
        "INSERT INTO locus_entities (id) VALUES (NULL)",
        "INSERT INTO locus_entities (id) VALUES (X'01')",
        "INSERT INTO locus_entities (id) VALUES ('1234567890123456')",
        "INSERT INTO locus_entities (id) VALUES (zeroblob(16))",
        "INSERT INTO locus_components (id, kind) VALUES (zeroblob(16), zeroblob(16))",
        "DELETE FROM locus_components",
        "UPDATE locus_memberships SET component = randomblob(16)",
        "UPDATE locus_memberships SET entity = randomblob(16)",
        "UPDATE locus_memberships SET kind = randomblob(16)",
    ] {
        let result = reopened
            .transaction::<(), CoreError, _>(move |context| {
                Box::pin(async move {
                    context.connection().batch_execute(statement).await?;
                    Ok(())
                })
            })
            .await;
        assert!(result.is_err(), "constraint accepted {statement}");
    }
    reopened
        .transaction::<(), CoreError, _>(|context| {
            Box::pin(async move {
                context
                    .connection()
                    .batch_execute("UPDATE locus_core_schema SET version = 999")
                    .await?;
                Ok(())
            })
        })
        .await
        .unwrap();
    assert!(matches!(
        kernel.initialize(&mut reopened).await,
        Err(CoreError::SchemaVersion(999))
    ));
    assert_eq!(
        kernel.memberships(&mut reopened, entity).await.unwrap(),
        vec![link]
    );
    assert!(payload_exists(&mut reopened, component).await);
}
