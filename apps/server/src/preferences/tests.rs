use super::{
    error::PreferenceError,
    identity::{SavedRevision, ViewDefinitionId},
    record::{Observation, SavedPreference, UpdateOutcome},
    service::PreferenceService,
};
use diesel_async::SimpleAsyncConnection;
use locus_core::api::{EntityId, Kernel, Membership};
use locus_media::api::{ImageOwner, MediaConfig, MediaKind, MediaService};
use locus_store::api::{Session, StoreError};
use std::{path::PathBuf, sync::Arc};

struct Fixture {
    root: tempfile::TempDir,
    path: PathBuf,
    session: Session,
    kernel: Kernel,
    preferences: PreferenceService,
}

async fn fixture() -> Fixture {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("metadata.sqlite");
    let mut session = Session::open(&path).await.unwrap();
    let mut kernel = Kernel::new();
    kernel.register(Arc::new(ImageOwner)).unwrap();
    kernel.initialize(&mut session).await.unwrap();
    let preferences = PreferenceService::new(kernel.clone());
    preferences.initialize(&mut session).await.unwrap();
    Fixture {
        root,
        path,
        session,
        kernel,
        preferences,
    }
}

fn view(value: &str) -> ViewDefinitionId {
    ViewDefinitionId::new(value.into()).unwrap()
}
fn revision(value: i64) -> SavedRevision {
    SavedRevision::new(value).unwrap()
}
fn saved(outcome: UpdateOutcome) -> SavedPreference {
    let UpdateOutcome::Saved(value) = outcome else {
        panic!("expected committed save")
    };
    value
}
async fn sql(session: &mut Session, source: &str) -> Result<(), PreferenceError> {
    let source = source.to_owned();
    session
        .transaction(move |context| {
            Box::pin(async move {
                context.connection().batch_execute(&source).await?;
                Ok(())
            })
        })
        .await
}

#[tokio::test(flavor = "multi_thread")]
async fn independent_ordered_observations_and_unknown_definition_survive_reopen() {
    let mut f = fixture().await;
    let a = f.kernel.create_entity(&mut f.session).await.unwrap();
    let b = f.kernel.create_entity(&mut f.session).await.unwrap();
    let missing = EntityId::new();
    assert!(
        f.preferences
            .read_batch(&mut f.session, vec![])
            .await
            .unwrap()
            .is_empty()
    );
    let initial = f
        .preferences
        .read_batch(&mut f.session, vec![a, b, missing, a])
        .await
        .unwrap();
    assert_eq!(
        initial,
        vec![
            Observation::Unset(a),
            Observation::Unset(b),
            Observation::Missing(missing),
            Observation::Unset(a)
        ]
    );
    let value = saved(
        f.preferences
            .update(&mut f.session, a, view("future.vendor/view-v42"), None)
            .await
            .unwrap(),
    );
    assert_eq!(value.revision, revision(1));
    assert_eq!(
        f.preferences
            .update(&mut f.session, b, view("image"), Some(revision(1)))
            .await
            .unwrap(),
        UpdateOutcome::Conflict(Observation::Unset(b))
    );
    assert_eq!(
        f.preferences
            .update(&mut f.session, missing, view("image"), None)
            .await
            .unwrap(),
        UpdateOutcome::Missing(missing)
    );
    drop(f.session);
    let mut reopened = Session::open(&f.path).await.unwrap();
    f.preferences.initialize(&mut reopened).await.unwrap();
    assert_eq!(
        f.preferences
            .read_batch(&mut reopened, vec![a, b, a])
            .await
            .unwrap(),
        vec![
            Observation::Saved(value.clone()),
            Observation::Unset(b),
            Observation::Saved(value)
        ]
    );
    assert!(
        !f.kernel
            .entity_exists(&mut reopened, missing)
            .await
            .unwrap()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_b_a_revisions_never_reset_and_old_prepared_writes_are_rejected() {
    let mut f = fixture().await;
    let entity = f.kernel.create_entity(&mut f.session).await.unwrap();
    let a = saved(
        f.preferences
            .update(&mut f.session, entity, view("A"), None)
            .await
            .unwrap(),
    );
    let b = saved(
        f.preferences
            .update(&mut f.session, entity, view("B"), Some(a.revision))
            .await
            .unwrap(),
    );
    let final_a = saved(
        f.preferences
            .update(&mut f.session, entity, view("A"), Some(b.revision))
            .await
            .unwrap(),
    );
    assert_eq!(final_a.revision, revision(3));
    for stale in [None, Some(a.revision), Some(b.revision)] {
        assert_eq!(
            f.preferences
                .update(&mut f.session, entity, view("obsolete"), stale)
                .await
                .unwrap(),
            UpdateOutcome::Conflict(Observation::Saved(final_a.clone()))
        );
    }
    assert_eq!(
        f.preferences.read(&mut f.session, entity).await.unwrap(),
        Observation::Saved(final_a)
    );
    sql(
        &mut f.session,
        "UPDATE locus_entity_view_preferences SET revision = 9223372036854775807",
    )
    .await
    .unwrap();
    assert!(
        matches!(f.preferences.update(&mut f.session, entity, view("overflow"), Some(revision(i64::MAX))).await, Err(PreferenceError::RevisionExhausted(id)) if id == entity)
    );
    let Observation::Saved(retained) = f.preferences.read(&mut f.session, entity).await.unwrap()
    else {
        panic!("saved")
    };
    assert_eq!(retained.revision, revision(i64::MAX));
    assert_eq!(retained.view_definition, view("A"));
}

#[tokio::test(flavor = "multi_thread")]
async fn independent_connections_compete_on_actual_sqlite_write_boundary() {
    let mut f = fixture().await;
    let entity = f.kernel.create_entity(&mut f.session).await.unwrap();
    let mut other = Session::open(&f.path).await.unwrap();
    for expected in [None, Some(revision(1))] {
        let (a, b) = tokio::join!(
            f.preferences
                .update(&mut f.session, entity, view("A"), expected),
            f.preferences
                .update(&mut other, entity, view("B"), expected),
        );
        let (a, b) = (a.unwrap(), b.unwrap());
        let (winner, current) = match (a, b) {
            (UpdateOutcome::Saved(value), UpdateOutcome::Conflict(current))
            | (UpdateOutcome::Conflict(current), UpdateOutcome::Saved(value)) => (value, current),
            _ => panic!("exactly one competing write must commit"),
        };
        assert_eq!(current, Observation::Saved(winner.clone()));
        assert_eq!(
            winner.revision,
            revision(expected.map_or(1, |r| r.value() + 1))
        );
        assert_eq!(
            f.preferences.read(&mut f.session, entity).await.unwrap(),
            current
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn failure_rolls_back_previous_row_and_whole_read_failure_is_not_empty_success() {
    let mut f = fixture().await;
    let entity = f.kernel.create_entity(&mut f.session).await.unwrap();
    let value = saved(
        f.preferences
            .update(&mut f.session, entity, view("A"), None)
            .await
            .unwrap(),
    );
    sql(&mut f.session, "CREATE TRIGGER reject_preference BEFORE UPDATE ON locus_entity_view_preferences BEGIN SELECT RAISE(ABORT, 'fixture write rejection'); END;").await.unwrap();
    assert!(matches!(
        f.preferences
            .update(&mut f.session, entity, view("B"), Some(value.revision))
            .await,
        Err(PreferenceError::Store(StoreError::Database(_)))
    ));
    assert_eq!(
        f.preferences.read(&mut f.session, entity).await.unwrap(),
        Observation::Saved(value)
    );
    sql(&mut f.session, "DROP TABLE locus_entity_view_preferences")
        .await
        .unwrap();
    assert!(matches!(
        f.preferences
            .read_batch(&mut f.session, vec![EntityId::new(), entity])
            .await,
        Err(PreferenceError::Store(StoreError::Database(_)))
    ));
}

#[tokio::test(flavor = "multi_thread")]
async fn real_commit_failure_is_unknown_and_discarded_session_reopens_previous_state() {
    let mut f = fixture().await;
    let entity = f.kernel.create_entity(&mut f.session).await.unwrap();
    let value = saved(
        f.preferences
            .update(&mut f.session, entity, view("before"), None)
            .await
            .unwrap(),
    );
    sql(&mut f.session, "CREATE TABLE fixture_parent (id INTEGER PRIMARY KEY);
        CREATE TABLE fixture_child (parent INTEGER REFERENCES fixture_parent(id) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER uncertain_preference AFTER UPDATE ON locus_entity_view_preferences BEGIN INSERT INTO fixture_child VALUES (1); END;").await.unwrap();
    let error = f
        .preferences
        .update(
            &mut f.session,
            entity,
            view("uncertain"),
            Some(value.revision),
        )
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        PreferenceError::Store(StoreError::CommitOutcomeUnknown(_))
    ));
    assert!(!f.session.is_usable());
    let mut reopened = Session::open(&f.path).await.unwrap();
    assert_eq!(
        f.preferences.read(&mut reopened, entity).await.unwrap(),
        Observation::Saved(value)
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn schema_and_corrupt_row_validation_never_replaces_retained_values() {
    let mut f = fixture().await;
    let entity = f.kernel.create_entity(&mut f.session).await.unwrap();
    f.preferences
        .update(&mut f.session, entity, view("valid"), None)
        .await
        .unwrap();
    for assignment in [
        "revision = 0",
        "revision = 1.5",
        "view_definition_id = ' '",
        "view_definition_id = char(10)",
    ] {
        sql(&mut f.session, &format!("PRAGMA ignore_check_constraints = ON; UPDATE locus_entity_view_preferences SET revision = 1, view_definition_id = 'valid'; UPDATE locus_entity_view_preferences SET {assignment}; PRAGMA ignore_check_constraints = OFF;")).await.unwrap();
        assert!(
            matches!(f.preferences.read(&mut f.session, entity).await, Err(PreferenceError::CorruptRecord { entity: id, .. }) if id == entity)
        );
        assert!(matches!(
            f.preferences
                .update(&mut f.session, entity, view("replacement"), None)
                .await,
            Err(PreferenceError::CorruptRecord { .. })
        ));
    }
    sql(
        &mut f.session,
        "UPDATE locus_preferences_schema SET version = 2",
    )
    .await
    .unwrap();
    assert!(matches!(
        f.preferences.initialize(&mut f.session).await,
        Err(PreferenceError::SchemaVersion(2))
    ));
    drop(f.session);
    let mut reopened = Session::open(&f.path).await.unwrap();
    assert!(matches!(
        f.preferences.initialize(&mut reopened).await,
        Err(PreferenceError::SchemaVersion(2))
    ));
}

#[tokio::test(flavor = "multi_thread")]
async fn preference_changes_preserve_domain_records_memberships_and_entity_deletion_meaning() {
    let mut f = fixture().await;
    let media = MediaService::new(f.root.path(), MediaConfig::default()).unwrap();
    media.initialize(&mut f.session).await.unwrap();
    let entity = f.kernel.create_entity(&mut f.session).await.unwrap();
    let component = media
        .create(&f.kernel, &mut f.session, MediaKind::Image)
        .await
        .unwrap();
    let membership = Membership {
        entity,
        kind: MediaKind::Image.kind(),
        component: component.component(),
    };
    f.kernel.attach(&mut f.session, membership).await.unwrap();
    let record = media.read(&mut f.session, component).await.unwrap();
    let memberships = f.kernel.memberships(&mut f.session, entity).await.unwrap();
    let value = saved(
        f.preferences
            .update(&mut f.session, entity, view("unsupported-view"), None)
            .await
            .unwrap(),
    );
    assert_eq!(
        f.kernel.memberships(&mut f.session, entity).await.unwrap(),
        memberships
    );
    assert_eq!(media.read(&mut f.session, component).await.unwrap(), record);
    f.kernel.detach(&mut f.session, membership).await.unwrap();
    let replacement = media
        .create(&f.kernel, &mut f.session, MediaKind::Image)
        .await
        .unwrap();
    f.kernel
        .attach(
            &mut f.session,
            Membership {
                component: replacement.component(),
                ..membership
            },
        )
        .await
        .unwrap();
    assert_eq!(
        f.preferences.read(&mut f.session, entity).await.unwrap(),
        Observation::Saved(value.clone())
    );
    f.kernel
        .delete_entity(&mut f.session, entity)
        .await
        .unwrap();
    assert_eq!(
        f.preferences.read(&mut f.session, entity).await.unwrap(),
        Observation::Missing(entity)
    );
    assert_eq!(
        f.preferences
            .update(&mut f.session, entity, view("image"), Some(value.revision))
            .await
            .unwrap(),
        UpdateOutcome::Missing(entity)
    );
    assert_eq!(media.read(&mut f.session, component).await.unwrap(), record);
    let retained = f
        .session
        .transaction(move |context| Box::pin(super::persistence::record::read(context, entity)))
        .await
        .unwrap();
    assert_eq!(retained, Some(value));
}

#[test]
fn input_validation_preserves_precision_and_opaque_definition_identity() {
    for input in [
        "",
        "0",
        "-1",
        "+1",
        "01",
        " 1",
        "1 ",
        "1.0",
        "1e3",
        "9223372036854775808",
    ] {
        assert!(SavedRevision::from_decimal(input).is_err(), "{input}");
    }
    assert_eq!(
        SavedRevision::from_decimal("9223372036854775807").unwrap(),
        revision(i64::MAX)
    );
    for input in ["", " ", " image", "image ", "line\nbreak", "nul\0"] {
        assert!(ViewDefinitionId::new(input.into()).is_err());
    }
    assert_eq!(view("future.定义/v7").as_str(), "future.定义/v7");
}

#[tokio::test(flavor = "multi_thread")]
async fn malformed_schema_version_rows_are_rejected_without_initializing_over_them() {
    for assignment in ["version = 1.5", "singleton = 2"] {
        let mut f = fixture().await;
        sql(&mut f.session, &format!("PRAGMA ignore_check_constraints = ON; UPDATE locus_preferences_schema SET {assignment}; PRAGMA ignore_check_constraints = OFF;")).await.unwrap();
        assert!(matches!(
            f.preferences.initialize(&mut f.session).await,
            Err(PreferenceError::CorruptSchema(_))
        ));
    }
}

#[test]
fn preference_mapping_preserves_nested_core_commit_uncertainty() {
    use crate::api::{
        core::dto::CoreFailure,
        error::{DomainDiagnostic, FailureKind},
        preferences::{dto::PreferenceFailure, mapping},
    };
    let uncertain = PreferenceError::Core(locus_core::api::CoreError::Store(
        StoreError::CommitOutcomeUnknown(diesel::result::Error::RollbackTransaction),
    ));
    let DomainDiagnostic::Preferences {
        error:
            PreferenceFailure::Core {
                error: CoreFailure::Store { diagnostic },
            },
    } = mapping::failure(uncertain)
    else {
        panic!("nested typed uncertainty")
    };
    assert_eq!(diagnostic.kind, FailureKind::CommitOutcomeUnknown);
}
