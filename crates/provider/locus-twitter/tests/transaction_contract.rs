#![allow(clippy::expect_used, clippy::unwrap_used)]
mod support;
use locus_core::api::Kernel;
use locus_store::api::{Session, StoreError};
use locus_twitter::api::*;
use std::{future::pending, time::Duration};
use support::*;
use tokio::{sync::oneshot, time::timeout};

#[tokio::test(flavor = "multi_thread")]
async fn create_participant_failure_is_atomic_when_caught_and_group_rolls_back() {
    let mut f = Fixture::new().await;
    f.session
        .transaction::<_, TwitterError, _>(|c| {
            Box::pin(async move {
                assert!(
                    TwitterService::create_in(&Kernel::new(), c, snapshot())
                        .await
                        .is_err()
                );
                Ok(())
            })
        })
        .await
        .unwrap();
    assert_eq!(
        count(
            &mut f.session,
            "SELECT count(*) AS count FROM locus_twitter_comp_snapshot"
        )
        .await,
        0
    );
    let kernel = f.kernel.clone();
    let result = f
        .session
        .transaction::<(), TwitterError, _>(move |c| {
            Box::pin(async move {
                let entity = kernel.create_entity_in(c).await?;
                let id = TwitterService::create_in(&kernel, c, snapshot()).await?;
                kernel.attach_in(c, membership(entity, id)).await?;
                Err(StoreError::Poisoned.into())
            })
        })
        .await;
    assert!(result.is_err());
    assert_eq!(
        count(
            &mut f.session,
            "SELECT count(*) AS count FROM locus_twitter_comp_snapshot"
        )
        .await,
        0
    );
    assert_eq!(
        count(
            &mut f.session,
            "SELECT count(*) AS count FROM locus_core_comm_component_registry"
        )
        .await,
        0
    );
    assert_eq!(
        count(
            &mut f.session,
            "SELECT count(*) AS count FROM locus_core_comm_entity"
        )
        .await,
        0
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn caught_combined_rejection_and_outer_rollback_preserve_previous_state() {
    let mut f = Fixture::new().await;
    let (entity, id) = f.component().await;
    let file = f.file(entity, "input").await;
    let old = f.associate(id, file).await;
    let token = f.prepare(id, file).await;
    let kernel = f.kernel.clone();
    f.session
        .transaction::<_, TwitterError, _>(move |c| {
            Box::pin(async move {
                assert!(
                    TwitterService::replace_and_associate_in(
                        &kernel,
                        c,
                        token,
                        TwitterSnapshot::default()
                    )
                    .await
                    .is_err()
                );
                Ok(())
            })
        })
        .await
        .unwrap();
    assert_eq!(f.twitter.read(&mut f.session, id).await.unwrap(), old);
    let token = f.prepare(id, file).await;
    let kernel = f.kernel.clone();
    assert!(
        f.session
            .transaction::<(), TwitterError, _>(move |c| Box::pin(async move {
                let result = TwitterService::replace_and_associate_in(
                    &kernel,
                    c,
                    token,
                    TwitterSnapshot {
                        text: Some("rolled back".into()),
                        ..snapshot()
                    },
                )
                .await?;
                assert!(matches!(result, WriteOutcome::Accepted(_)));
                Err(StoreError::Poisoned.into())
            }))
            .await
            .is_err()
    );
    assert_eq!(f.twitter.read(&mut f.session, id).await.unwrap(), old);
    let kernel = f.kernel.clone();
    f.session
        .transaction::<_, TwitterError, _>(move |c| {
            Box::pin(async move {
                let token = TwitterService::prepare_association_in(&kernel, c, id, file).await?;
                assert!(matches!(
                    TwitterService::associate_in(&kernel, c, token).await?,
                    WriteOutcome::Accepted(_)
                ));
                assert!(matches!(
                    TwitterService::replace_in(c, id, old.revision + 1, snapshot()).await?,
                    WriteOutcome::Accepted(_)
                ));
                Ok(())
            })
        })
        .await
        .unwrap();
    assert_eq!(
        f.twitter.read(&mut f.session, id).await.unwrap().basis,
        None
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn cancellation_discards_session_and_does_not_publish_provisional_source() {
    let mut f = Fixture::new().await;
    let committed = f
        .twitter
        .create(&f.kernel, &mut f.session, snapshot())
        .await
        .unwrap();
    let kernel = f.kernel.clone();
    let (written, ready) = oneshot::channel();
    {
        let transaction = f.session.transaction::<(), TwitterError, _>(move |c| {
            Box::pin(async move {
                let entity = kernel.create_entity_in(c).await?;
                let id = TwitterService::create_in(&kernel, c, snapshot()).await?;
                kernel.attach_in(c, membership(entity, id)).await?;
                TwitterService::replace_in(
                    c,
                    committed,
                    0,
                    TwitterSnapshot {
                        text: Some("abandoned".into()),
                        ..snapshot()
                    },
                )
                .await?;
                written.send(()).unwrap();
                pending().await
            })
        });
        tokio::pin!(transaction);
        timeout(Duration::from_secs(10),async {
            tokio::select! { result = &mut transaction => panic!("unexpected completion {result:?}"), ready = ready => ready.unwrap() }
        }).await.unwrap();
    }
    assert!(!f.session.is_usable());
    f.session = Session::open(&f.database).await.unwrap();
    assert_eq!(
        count(
            &mut f.session,
            "SELECT count(*) AS count FROM locus_twitter_comp_snapshot"
        )
        .await,
        1
    );
    assert_eq!(
        f.twitter
            .read(&mut f.session, committed)
            .await
            .unwrap()
            .snapshot,
        snapshot()
    );
    assert_eq!(
        count(
            &mut f.session,
            "SELECT count(*) AS count FROM locus_core_comm_entity"
        )
        .await,
        0
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn caught_database_failure_cannot_partly_accept_combined_snapshot_and_basis() {
    let mut f = Fixture::new().await;
    let (entity, id) = f.component().await;
    let file = f.file(entity, "input").await;
    let before = f.twitter.read(&mut f.session, id).await.unwrap();
    let token = f.prepare(id, file).await;
    execute(&mut f.session,"CREATE TRIGGER fail_twitter_update AFTER UPDATE ON locus_twitter_comp_snapshot BEGIN SELECT RAISE(FAIL, 'injected participant failure'); END".into()).await;
    let kernel = f.kernel.clone();
    f.session
        .transaction::<_, TwitterError, _>(move |c| {
            Box::pin(async move {
                assert!(matches!(
                    TwitterService::replace_and_associate_in(
                        &kernel,
                        c,
                        token,
                        TwitterSnapshot {
                            text: Some("must not survive".into()),
                            ..snapshot()
                        }
                    )
                    .await,
                    Err(TwitterError::Database(_))
                ));
                Ok(())
            })
        })
        .await
        .unwrap();
    assert_eq!(f.twitter.read(&mut f.session, id).await.unwrap(), before);
}
