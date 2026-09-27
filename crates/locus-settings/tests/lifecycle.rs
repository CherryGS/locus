#![allow(clippy::expect_used, clippy::unwrap_used)]
use diesel::sql_types::{BigInt, Text};
use diesel_async::{RunQueryDsl, SimpleAsyncConnection};
use locus_settings::api::*;
use locus_store::api::{Session, StoreError};
use serde::{Deserialize, Serialize};
use serde_json::json;
const ID: GroupId = GroupId::from_u128(123);
#[derive(Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct Values {
    text: String,
    optional: Option<String>,
    nested: Vec<Vec<String>>,
    added: bool,
}
struct Owner {
    id: GroupId,
    default: &'static str,
}
impl Provider for Owner {
    type Value = Values;
    fn group_id(&self) -> GroupId {
        self.id
    }
    fn name(&self) -> &'static str {
        "TestValues"
    }
    fn version(&self) -> u32 {
        2
    }
    fn defaults(&self) -> Values {
        Values {
            text: self.default.into(),
            optional: None,
            nested: vec![vec![]],
            added: true,
        }
    }
    fn validate(&self, v: &Values) -> Result<(), String> {
        if v.text.contains('\0') {
            Err("NUL".into())
        } else {
            Ok(())
        }
    }
}
fn service(default: &'static str) -> SettingsService {
    let mut registry = Registry::new();
    registry.register(Owner { id: ID, default }).unwrap();
    SettingsService::new(registry)
}
fn saved(result: WriteOutcome) -> SavedValue {
    match result {
        WriteOutcome::Saved(v) => v,
        _ => panic!("saved"),
    }
}
async fn inject(session: &mut Session, id: GroupId, version: i64, payload: &str) {
    let payload = payload.to_owned();
    session
        .transaction::<_, SettingsError, _>(move |ctx| {
            Box::pin(async move {
                diesel::sql_query(
                    "UPDATE locus_settings_comm_group_value SET version=?,payload=? WHERE group_id=?",
                )
                .bind::<BigInt, _>(version)
                .bind::<Text, _>(payload)
                .bind::<Text, _>(id.to_string())
                .execute(ctx.connection())
                .await?;
                Ok(())
            })
        })
        .await
        .unwrap();
}
#[test]
fn definitions_and_duplicate_registration_require_no_database() {
    let mut registry = Registry::new();
    registry
        .register(Owner {
            id: ID,
            default: "old",
        })
        .unwrap();
    assert!(matches!(
        registry.register(Owner {
            id: ID,
            default: "other"
        }),
        Err(SettingsError::Duplicate(_))
    ));
    let defs = registry.definitions().unwrap();
    assert_eq!(
        defs[0].defaults,
        json!({"text":"old","optional":null,"nested":[[]],"added":true})
    );
    assert!(defs[0].schema["properties"]["optional"].is_object());
}
#[tokio::test(flavor = "multi_thread")]
async fn absence_full_retention_changed_defaults_reset_and_library_isolation() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("one.sqlite");
    let mut session = Session::open(&path).await.unwrap();
    let service = service("old");
    assert!(matches!(
        service.read(&mut session, ID).await,
        Err(SettingsError::Store(_))
    ));
    locus_migration::api::migrate(&mut session).await.unwrap();
    assert!(matches!(
        service.read(&mut session, ID).await.unwrap(),
        Observation::Absent { .. }
    ));
    let first = saved(service.initialize(&mut session, ID).await.unwrap());
    let value = json!({"text":"","optional":null,"nested":[[],["same",""]],"added":true});
    let second = saved(
        service
            .update(
                &mut session,
                ID,
                first.metadata.revision.clone(),
                value.clone(),
            )
            .await
            .unwrap(),
    );
    assert_ne!(first.metadata.revision, second.metadata.revision);
    assert!(matches!(
        service
            .update(
                &mut session,
                ID,
                first.metadata.revision.clone(),
                value.clone()
            )
            .await
            .unwrap(),
        WriteOutcome::Conflict(_)
    ));
    assert!(matches!(
        service
            .reset(&mut session, ID, first.metadata.revision)
            .await
            .unwrap(),
        WriteOutcome::Conflict(_)
    ));
    drop(session);
    let changed = crate::service("new default");
    let mut reopened = Session::open(path).await.unwrap();
    assert_eq!(
        changed.read(&mut reopened, ID).await.unwrap(),
        Observation::Current {
            saved: second.clone()
        }
    );
    assert!(matches!(
        changed.initialize(&mut reopened, ID).await.unwrap(),
        WriteOutcome::Existing(_)
    ));
    let reset = saved(
        changed
            .reset(&mut reopened, ID, second.metadata.revision.clone())
            .await
            .unwrap(),
    );
    assert_eq!(reset.value["text"], "new default");
    assert_ne!(reset.metadata.revision, second.metadata.revision);
    let mut other = Session::open(root.path().join("two.sqlite")).await.unwrap();
    locus_migration::api::migrate(&mut other).await.unwrap();
    assert!(matches!(
        changed.read(&mut other, ID).await.unwrap(),
        Observation::Absent { .. }
    ));
    let isolated = saved(changed.initialize(&mut other, ID).await.unwrap());
    assert!(matches!(
        changed
            .update(&mut other, ID, reset.metadata.revision.clone(), value)
            .await
            .unwrap(),
        WriteOutcome::Conflict(_)
    ));
    assert_ne!(isolated.metadata.revision, reset.metadata.revision);
}

#[tokio::test(flavor = "multi_thread")]
async fn independent_connections_race_without_overwriting_and_groups_are_isolated() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("race.sqlite");
    let service = service("initial");
    let mut first = Session::open(&path).await.unwrap();
    locus_migration::api::migrate(&mut first).await.unwrap();
    let mut second = Session::open(&path).await.unwrap();
    let (a, b) = tokio::join!(
        service.initialize(&mut first, ID),
        service.initialize(&mut second, ID)
    );
    let winner = match (a.unwrap(), b.unwrap()) {
        (WriteOutcome::Saved(v), WriteOutcome::Existing(_))
        | (WriteOutcome::Existing(_), WriteOutcome::Saved(v)) => v,
        _ => panic!("one winner"),
    };
    let (a, b) = tokio::join!(
        service.update(
            &mut first,
            ID,
            winner.metadata.revision.clone(),
            json!({"text":"a","optional":"","nested":[],"added":false})
        ),
        service.reset(&mut second, ID, winner.metadata.revision.clone())
    );
    assert!(matches!(
        (a.unwrap(), b.unwrap()),
        (WriteOutcome::Saved(_), WriteOutcome::Conflict(_))
            | (WriteOutcome::Conflict(_), WriteOutcome::Saved(_))
    ));
    let mut registry = Registry::new();
    registry
        .register(Owner {
            id: GroupId::from_u128(456),
            default: "independent",
        })
        .unwrap();
    let other = SettingsService::new(registry);
    let before = service.read(&mut first, ID).await.unwrap();
    other
        .initialize(&mut first, GroupId::from_u128(456))
        .await
        .unwrap();
    assert_eq!(service.read(&mut first, ID).await.unwrap(), before);
}
#[tokio::test(flavor = "multi_thread")]
async fn participant_rollback_and_real_deferred_commit_failure_remain_distinct() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("commit.sqlite");
    let service = service("initial");
    let mut session = Session::open(&path).await.unwrap();
    locus_migration::api::migrate(&mut session).await.unwrap();
    let participant = service.clone();
    let error = session
        .transaction::<(), SettingsError, _>(move |ctx| {
            Box::pin(async move {
                assert!(matches!(
                    participant.initialize_in(ctx, ID).await?,
                    WriteOutcome::Saved(_)
                ));
                Err(SettingsError::Invalid("outer rejects".into()))
            })
        })
        .await
        .unwrap_err();
    assert!(matches!(error, SettingsError::Invalid(_)));
    assert!(matches!(
        service.read(&mut session, ID).await.unwrap(),
        Observation::Absent { .. }
    ));
    let participant = service.clone();
    let error=session.transaction::<(),SettingsError,_>(move |ctx|Box::pin(async move {
        participant.initialize_in(ctx,ID).await?;
        ctx.connection().batch_execute("CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED); INSERT INTO child VALUES(1);").await?;
        Ok(())
    })).await.unwrap_err();
    assert!(matches!(
        error,
        SettingsError::Store(StoreError::CommitOutcomeUnknown(_))
    ));
    assert!(!session.is_usable());
    // A later independent observation is evidence of current state, not a claim
    // that uncertain completion proved rollback.
    let mut fresh = Session::open(&path).await.unwrap();
    assert!(matches!(
        service.read(&mut fresh, ID).await.unwrap(),
        Observation::Absent { .. }
    ));
}
#[tokio::test(flavor = "multi_thread")]
async fn separately_opened_task_databases_share_exclusion_for_settings() {
    use locus_store::api::TaskDatabase;
    use locus_task::api::TaskQueue;
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("tasks.sqlite");
    let queue = TaskQueue::new();
    let first = TaskDatabase::open(&queue, &path).await.unwrap();
    let second = TaskDatabase::open(&queue, &path).await.unwrap();
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = tokio::sync::oneshot::channel();
    let holder = queue
        .submit("holder", move |task| async move {
            let mut session = first.session(&task).await.unwrap();
            locus_migration::api::migrate(&mut session).await.unwrap();
            session
                .transaction::<_, StoreError, _>(move |_| {
                    Box::pin(async move {
                        entered_tx.send(()).unwrap();
                        release_rx.await.unwrap();
                        Ok(())
                    })
                })
                .await
                .unwrap();
        })
        .unwrap();
    entered_rx.await.unwrap();
    let (observed_tx, mut observed_rx) = tokio::sync::oneshot::channel();
    let reader = queue
        .submit("read", move |task| async move {
            let mut session = second.session(&task).await.unwrap();
            let value = service("initial").read(&mut session, ID).await.unwrap();
            observed_tx.send(value).unwrap();
        })
        .unwrap();
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), &mut observed_rx)
            .await
            .is_err()
    );
    release_tx.send(()).unwrap();
    holder.result().await.unwrap();
    reader.result().await.unwrap();
    assert!(matches!(
        observed_rx.await.unwrap(),
        Observation::Absent { .. }
    ));
}

#[derive(Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct FloatValue {
    number: f64,
}
struct FloatOwner;
impl Provider for FloatOwner {
    type Value = FloatValue;
    fn group_id(&self) -> GroupId {
        ID
    }
    fn name(&self) -> &'static str {
        "FloatValue"
    }
    fn version(&self) -> u32 {
        1
    }
    fn defaults(&self) -> FloatValue {
        FloatValue { number: 1.0 }
    }
    fn validate(&self, value: &FloatValue) -> Result<(), String> {
        if value.number.is_finite() {
            Ok(())
        } else {
            Err("nonfinite".into())
        }
    }
}

#[derive(Serialize, Deserialize, schemars::JsonSchema)]
struct OptionalFloatValue {
    number: Option<f64>,
}
struct OptionalFloatOwner {
    invalid_defaults: bool,
}
impl Provider for OptionalFloatOwner {
    type Value = OptionalFloatValue;
    fn group_id(&self) -> GroupId {
        ID
    }
    fn name(&self) -> &'static str {
        "OptionalFloatValue"
    }
    fn version(&self) -> u32 {
        1
    }
    fn defaults(&self) -> OptionalFloatValue {
        OptionalFloatValue {
            number: self.invalid_defaults.then_some(f64::NAN),
        }
    }
    fn validate(&self, value: &OptionalFloatValue) -> Result<(), String> {
        if value.number.is_none_or(f64::is_finite) {
            Ok(())
        } else {
            Err("nonfinite".into())
        }
    }
}
#[test]
fn invalid_typed_defaults_are_rejected_before_json_can_turn_them_into_null() {
    let mut registry = Registry::new();
    assert!(matches!(
        registry.register(OptionalFloatOwner {
            invalid_defaults: true,
        }),
        Err(SettingsError::Invalid(_))
    ));
    assert!(registry.definitions().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn integral_float_defaults_accept_js_round_trip_without_accepting_loss() {
    let mut registry = Registry::new();
    registry.register(FloatOwner).unwrap();
    let service = SettingsService::new(registry);
    let mut session = Session::memory().await.unwrap();
    locus_migration::api::migrate(&mut session).await.unwrap();
    let first = saved(service.initialize(&mut session, ID).await.unwrap());
    let next = saved(
        service
            .update(
                &mut session,
                ID,
                first.metadata.revision,
                json!({"number":1}),
            )
            .await
            .unwrap(),
    );
    for bad in [
        json!({"number":9007199254740993_u64}),
        json!({}),
        json!({"number":1,"extra":null}),
    ] {
        assert!(matches!(
            service
                .update(&mut session, ID, next.metadata.revision.clone(), bad)
                .await,
            Err(SettingsError::Invalid(_))
        ));
    }
}
async fn sql(session: &mut Session, statement: &str) {
    let statement = statement.to_owned();
    session
        .transaction::<_, SettingsError, _>(move |ctx| {
            Box::pin(async move {
                ctx.connection().batch_execute(&statement).await?;
                Ok(())
            })
        })
        .await
        .unwrap();
}
#[tokio::test(flavor = "multi_thread")]
async fn corrupt_outer_metadata_and_schema_markers_never_authorize_blind_repair() {
    let service = service("initial");
    let mut session = Session::memory().await.unwrap();
    locus_migration::api::migrate(&mut session).await.unwrap();
    let initial = saved(service.initialize(&mut session, ID).await.unwrap());
    sql(
        &mut session,
        "UPDATE locus_settings_comm_group_value SET version=2.5",
    )
    .await;
    assert!(matches!(
        service.read(&mut session, ID).await.unwrap(),
        Observation::Corrupt {
            version: None,
            revision: Some(_),
            ..
        }
    ));
    let initial = saved(
        service
            .reset(&mut session, ID, initial.metadata.revision)
            .await
            .unwrap(),
    );
    for statement in [
        "UPDATE locus_settings_comm_group_value SET version=2,revision=''",
        "UPDATE locus_settings_comm_group_value SET revision=x'0102'",
        "UPDATE locus_settings_comm_group_value SET revision='not-a-revision'",
    ] {
        sql(&mut session, statement).await;
        let observed = service.read(&mut session, ID).await.unwrap();
        assert!(matches!(observed, Observation::Corrupt { .. }));
        assert!(matches!(
            service
                .reset(&mut session, ID, initial.metadata.revision.clone())
                .await
                .unwrap(),
            WriteOutcome::Conflict(Observation::Corrupt { .. })
        ));
        assert_eq!(service.read(&mut session, ID).await.unwrap(), observed);
    }
    sql(
        &mut session,
        &format!(
            "UPDATE locus_settings_comm_group_value SET version=2,revision='{}',payload=x'ff'",
            initial.metadata.revision
        ),
    )
    .await;
    assert!(
        matches!(service.read(&mut session,ID).await.unwrap(),Observation::Invalid { metadata,.. } if metadata==initial.metadata)
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn old_and_new_representations_are_unsupported_without_rewriting_values() {
    let service = service("current");
    let mut session = Session::memory().await.unwrap();
    locus_migration::api::migrate(&mut session).await.unwrap();
    let initial = saved(service.initialize(&mut session, ID).await.unwrap());
    for version in [0, 1, 3] {
        inject(&mut session, ID, version, "{}").await;
        let Observation::Unsupported { metadata, .. } =
            service.read(&mut session, ID).await.unwrap()
        else {
            panic!("unsupported");
        };
        assert_eq!(metadata.version, version);
        assert_eq!(metadata.revision, initial.metadata.revision);
        assert!(matches!(
            service.initialize(&mut session, ID).await.unwrap(),
            WriteOutcome::Existing(Observation::Unsupported { .. })
        ));
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn invalid_current_values_and_unavailable_owner_keep_metadata_and_guard_reset() {
    let service = service("current");
    let mut session = Session::memory().await.unwrap();
    locus_migration::api::migrate(&mut session).await.unwrap();
    let initial = saved(service.initialize(&mut session, ID).await.unwrap());
    for payload in [
        "{",
        r#"{"text":"retained","nested":[],"added":true}"#,
        r#"{"text":null,"optional":null,"nested":[],"added":true}"#,
    ] {
        inject(&mut session, ID, 2, payload).await;
        let Observation::Invalid { metadata, .. } = service.read(&mut session, ID).await.unwrap()
        else {
            panic!("invalid");
        };
        assert_eq!(metadata, initial.metadata);
    }
    let unavailable = SettingsService::new(Registry::new());
    assert!(matches!(
        unavailable.read(&mut session, ID).await.unwrap(),
        Observation::Unavailable {
            metadata: Some(_),
            ..
        }
    ));
    assert!(matches!(
        unavailable
            .reset(&mut session, ID, initial.metadata.revision.clone())
            .await,
        Err(SettingsError::Unavailable(_))
    ));
    let reset = saved(
        service
            .reset(&mut session, ID, initial.metadata.revision.clone())
            .await
            .unwrap(),
    );
    assert_ne!(reset.metadata.revision, initial.metadata.revision);
    assert_eq!(reset.value["text"], "current");
}
