#![allow(clippy::expect_used, clippy::unwrap_used)]
mod support;
use diesel::connection::InstrumentationEvent;
use diesel_async::AsyncConnection;
use locus_core::api::{CoreError, EntityId, Membership};
use locus_file::api::{
    CurrentInput, FILE_KIND, FileError, InputComparison, compare_input, observe_input,
    observe_input_in,
};
use locus_store::api::Session;
use std::time::Duration;
use support::*;
use tokio::{sync::oneshot, time::timeout};

#[tokio::test(flavor = "multi_thread")]
async fn independent_bases_missing_context_and_unavailable_payloads_remain_distinct() {
    let mut f = Fixture::new().await;
    let entity = f.kernel.create_entity(&mut f.session).await.unwrap();
    let absent = EntityId::new();
    for (host, expected) in [
        (entity, CurrentInput::MissingSlot(entity)),
        (absent, CurrentInput::MissingEntity(absent)),
    ] {
        assert_eq!(
            compare_input(None, observe_input(&f.kernel, &mut f.session, host).await).unwrap(),
            InputComparison::Incomplete {
                basis: None,
                current: expected
            }
        );
    }
    let first = f
        .files
        .admit(&f.kernel, &mut f.session, &f.source)
        .await
        .unwrap();
    let second = f
        .files
        .admit(&f.kernel, &mut f.session, &f.source)
        .await
        .unwrap();
    let link = Membership {
        entity,
        kind: FILE_KIND,
        component: first.id.component(),
    };
    f.kernel.attach(&mut f.session, link).await.unwrap();
    assert_eq!(
        compare_input(
            Some(first.id),
            observe_input(&f.kernel, &mut f.session, entity).await
        )
        .unwrap(),
        InputComparison::Matching(first.id)
    );
    f.kernel.detach(&mut f.session, link).await.unwrap();
    let updated = Membership {
        component: second.id.component(),
        ..link
    };
    f.kernel.attach(&mut f.session, updated).await.unwrap();
    let observed = observe_input(&f.kernel, &mut f.session, entity)
        .await
        .unwrap();
    let participant = f.kernel.clone();
    f.session
        .transaction::<_, FileError, _>(move |context| {
            Box::pin(async move {
                use diesel_async::RunQueryDsl;
                let before = diesel::sql_query("SELECT total_changes() AS count")
                    .get_result::<Count>(context.connection())
                    .await?
                    .count;
                let observed = observe_input_in(&participant, context, entity).await?;
                compare_input(Some(first.id), Ok(observed))?;
                let after = diesel::sql_query("SELECT total_changes() AS count")
                    .get_result::<Count>(context.connection())
                    .await?
                    .count;
                assert_eq!(before, after);
                Ok(())
            })
        })
        .await
        .unwrap();

    assert_eq!(
        compare_input(Some(first.id), Ok(observed)).unwrap(),
        InputComparison::Changed {
            basis: first.id,
            current: second.id
        }
    );
    assert_eq!(
        compare_input(Some(second.id), Ok(observed)).unwrap(),
        InputComparison::Matching(second.id)
    );
    assert_eq!(
        compare_input(None, Ok(observed)).unwrap(),
        InputComparison::Incomplete {
            basis: None,
            current: observed
        }
    );
    // Damage the accepted input to prove observation neither checks bytes nor
    // treats its known membership as absent when payload read fails.
    std::fs::remove_file(f.files.root().join(&second.relative_path)).unwrap();
    assert_eq!(
        observe_input(&f.kernel, &mut f.session, entity)
            .await
            .unwrap(),
        observed
    );
    assert!(matches!(
        f.files.open(&mut f.session, second.id).await,
        Err(FileError::Access { .. })
    ));
    execute(&mut f.session, "DELETE FROM locus_file_comp_file").await;
    assert_eq!(
        observe_input(&f.kernel, &mut f.session, entity)
            .await
            .unwrap(),
        observed
    );
    assert!(matches!(
        f.files.read(&mut f.session, second.id).await,
        Err(FileError::MissingRecord(_))
    ));
    assert_eq!(
        count(
            &mut f.session,
            "SELECT count(*) AS count FROM locus_core_rela_membership"
        )
        .await,
        1
    );
    assert_eq!(
        count(
            &mut f.session,
            "SELECT count(*) AS count FROM locus_core_comm_component_registry"
        )
        .await,
        2
    );
    assert!(f.files.root().join(&first.relative_path).is_file()); // No fallback or cleanup.
    assert!(f.source.is_file());
    assert!(f.directory.path().is_dir());
    let mut reopened = Session::open(&f.database).await.unwrap();
    assert_eq!(
        observe_input(&f.kernel, &mut reopened, entity)
            .await
            .unwrap(),
        observed
    );
    execute(&mut reopened, "DROP TABLE locus_core_rela_membership").await;
    let result = compare_input(None, observe_input(&f.kernel, &mut reopened, entity).await);
    assert!(matches!(
        result,
        Err(FileError::Core(CoreError::Database(_)))
    ));
}

#[tokio::test(flavor = "multi_thread")]
async fn participating_observation_uses_its_actual_boundary_after_intervening_writer() {
    timeout(Duration::from_secs(10), async {
        let mut f = Fixture::new().await;
        let first = f
            .files
            .admit(&f.kernel, &mut f.session, &f.source)
            .await
            .unwrap();
        let second = f
            .files
            .admit(&f.kernel, &mut f.session, &f.source)
            .await
            .unwrap();
        let entity = f.kernel.create_entity(&mut f.session).await.unwrap();
        let link = Membership {
            entity,
            kind: FILE_KIND,
            component: first.id.component(),
        };
        f.kernel.attach(&mut f.session, link).await.unwrap();
        let earlier = observe_input(&f.kernel, &mut f.session, entity)
            .await
            .unwrap();
        let mut reader = Session::open(&f.database).await.unwrap();
        let (begin, began) = oneshot::channel();
        reader
            .transaction::<_, FileError, _>(move |context| {
                Box::pin(async move {
                    let mut begin = Some(begin);
                    context.connection().set_instrumentation(
                        move |event: InstrumentationEvent<'_>| {
                            if let InstrumentationEvent::StartQuery { query, .. } = event
                                && query.to_string() == "BEGIN IMMEDIATE"
                                && let Some(begin) = begin.take()
                            {
                                begin.send(()).unwrap();
                            }
                        },
                    );
                    Ok(())
                })
            })
            .await
            .unwrap();
        let kernel = f.kernel.clone();
        let (changed, ready) = oneshot::channel();
        let (commit, committed) = oneshot::channel();
        let writer = tokio::spawn(async move {
            f.session
                .transaction::<_, FileError, _>(move |context| {
                    Box::pin(async move {
                        kernel.detach_in(context, link).await?;
                        kernel
                            .attach_in(
                                context,
                                Membership {
                                    component: second.id.component(),
                                    ..link
                                },
                            )
                            .await?;
                        changed.send(()).unwrap();
                        committed.await.unwrap();
                        Ok(())
                    })
                })
                .await
        });
        ready.await.unwrap();
        let kernel = f.kernel.clone();
        let read = reader.transaction::<_, FileError, _>(move |context| {
            Box::pin(async move { observe_input_in(&kernel, context, entity).await })
        });
        tokio::pin!(read);
        tokio::select! {
            result = &mut read => panic!("reader crossed writer's boundary early: {result:?}"),
            began = began => began.unwrap(),
        }
        commit.send(()).unwrap();
        let now = read.await.unwrap();
        writer.await.unwrap().unwrap();
        assert_eq!(earlier, CurrentInput::File(first.id));
        assert_eq!(now, CurrentInput::File(second.id));
        assert_eq!(
            compare_input(Some(first.id), Ok(now)).unwrap(),
            InputComparison::Changed {
                basis: first.id,
                current: second.id
            }
        );
    })
    .await
    .expect("bounded inter-connection observation");
}
