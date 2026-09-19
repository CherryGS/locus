#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use diesel::{connection::InstrumentationEvent, sql_query, sql_types::Binary};
use diesel_async::{AsyncConnection, RunQueryDsl};
use locus_core::{AttachOutcome, CoreError, Membership};
use locus_store::Session;
use std::time::Duration;
use support::domain::*;
use tokio::{sync::oneshot, time::timeout};

#[derive(Clone, Copy)]
enum First {
    Attach,
    AttachOther,
    DeleteComponent,
    DeleteEntity,
}

async fn race(first: First, against_entity: bool) {
    timeout(Duration::from_secs(10), async {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("race.sqlite");
        let mut left = Session::open(&path).await.unwrap();
        let mut right = Session::open(&path).await.unwrap();
        let kernel = fixture(&mut left).await;
        let entity = kernel.create_entity(&mut left).await.unwrap();
        let other_entity = kernel.create_entity(&mut left).await.unwrap();
        let component = saved_component(&kernel, &mut left, KIND).await;
        let link = Membership {
            entity,
            kind: KIND,
            component,
        };
        let (begin_started, begin_observed) = oneshot::channel();
        right.transaction::<(),CoreError,_>(move |context| Box::pin(async move {
            let mut sender = Some(begin_started);
            context.connection().set_instrumentation(move |event: InstrumentationEvent<'_>| {
                if let InstrumentationEvent::StartQuery { query, .. } = event
                    && query.to_string() == "BEGIN IMMEDIATE"
                    && let Some(sender) = sender.take()
                {
                    sender.send(()).unwrap();
                }
            });
            Ok(())
        })).await.unwrap();
        let participant = kernel.clone();
        let (entered, ready) = oneshot::channel();
        let (release, released) = oneshot::channel();
        let first_writer = tokio::spawn(async move {
            left.transaction::<(), CoreError, _>(move |context| {
                Box::pin(async move {
                    match first {
                        First::Attach | First::AttachOther => {
                            participant.attach_in(context, link).await?;
                        }
                        First::DeleteComponent => {
                            participant
                                .delete_component_in(context, KIND, component)
                                .await?
                        }
                        First::DeleteEntity => {
                            participant.delete_entity_in(context, entity).await?
                        }
                    }
                    entered.send(()).unwrap();
                    released.await.unwrap();
                    Ok(())
                })
            })
            .await
        });
        ready.await.unwrap();
        let contender = async {
            match first {
                First::AttachOther => kernel.attach(&mut right, Membership { entity: other_entity, ..link }).await.map(Some),
                First::Attach if against_entity => kernel
                    .delete_entity(&mut right, entity)
                    .await
                    .map(|()| None),
                First::Attach => kernel
                    .delete_component(&mut right, KIND, component)
                    .await
                    .map(|()| None),
                _ => kernel.attach(&mut right, link).await.map(Some),
            }
        };
        let result;
        {
            tokio::pin!(contender);
            // Instrumentation runs on the driver's blocking worker before executing
            // BEGIN, proving the second connection actually entered its competing
            // query while the first transaction still owns its SQLite write lock.
            tokio::select! {
                result = &mut contender => panic!("contender completed before first writer released: {result:?}"),
                observed = begin_observed => observed.unwrap(),
            }
            release.send(()).unwrap();
            result = contender.await;
        }
        first_writer.await.unwrap().unwrap();
        match first {
            First::AttachOther => assert!(matches!(result, Err(CoreError::AttachmentOccupied(existing)) if existing == link)),
            First::Attach if against_entity => assert!(result.unwrap().is_none()),
            First::Attach => {
                assert!(matches!(result, Err(CoreError::ComponentAttached(id)) if id == component))
            }
            First::DeleteComponent => {
                assert!(matches!(result, Err(CoreError::MissingComponent(id)) if id == component))
            }
            First::DeleteEntity => {
                assert!(matches!(result, Err(CoreError::MissingEntity(id)) if id == entity))
            }
        }
        if against_entity || matches!(first, First::DeleteEntity) {
            let memberships_left = right.transaction::<_,CoreError,_>(move |context| Box::pin(async move {
                Ok(sql_query("SELECT count(*) AS count FROM locus_memberships WHERE entity = ?")
                    .bind::<Binary,_>(entity.as_bytes().as_slice()).get_result::<Count>(context.connection()).await?.count)
            })).await.unwrap();
            assert_eq!(memberships_left, 0);
            assert!(!kernel.entity_exists(&mut right, entity).await.unwrap());
            assert!(payload_exists(&mut right, component).await);
            assert_eq!(
                kernel.component_kind(&mut right, component).await.unwrap(),
                KIND
            );
        } else if matches!(first, First::Attach | First::AttachOther) {
            assert_eq!(
                kernel.memberships(&mut right, entity).await.unwrap(),
                vec![link]
            );
            assert!(payload_exists(&mut right, component).await);
            assert_eq!(
                kernel.attach(&mut right, link).await.unwrap(),
                AttachOutcome::AlreadyAttached
            );
        } else {
            assert!(
                kernel
                    .memberships(&mut right, entity)
                    .await
                    .unwrap()
                    .is_empty()
            );
            assert!(!payload_exists(&mut right, component).await);
            assert!(matches!(
                kernel.component_kind(&mut right, component).await,
                Err(CoreError::MissingComponent(_))
            ));
        }
    })
    .await
    .expect("bounded inter-connection race");
}

#[tokio::test(flavor = "multi_thread")]
async fn attachment_first_blocks_component_deletion() {
    race(First::Attach, false).await;
}
#[tokio::test(flavor = "multi_thread")]
async fn component_deletion_first_prevents_attachment() {
    race(First::DeleteComponent, false).await;
}
#[tokio::test(flavor = "multi_thread")]
async fn attachment_first_is_removed_by_entity_deletion() {
    race(First::Attach, true).await;
}
#[tokio::test(flavor = "multi_thread")]
async fn entity_deletion_first_prevents_attachment() {
    race(First::DeleteEntity, true).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn competing_exclusive_attachments_have_exactly_one_winner() {
    race(First::AttachOther, false).await;
}
