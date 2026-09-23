use crate::{
    error::ModelError, identity::MODEL_KIND, input::InputContext, inspection::ApplyOutcome,
    owner::ModelOwner, recognition::RecognitionOutcome, service::ModelService,
};
use locus_core::api::{Kernel, Membership};
use locus_file::api::{FILE_KIND, FileOwner, FileService, InputComparison};
use locus_store::api::Session;
use std::sync::Arc;
fn fixture(path: &std::path::Path, metadata: bool) {
    let header = if metadata {
        r#"{"__metadata__":{"name":"declared"},"x":{"dtype":"F32","shape":[],"data_offsets":[0,4]}}"#
    } else {
        r#"{"x":{"dtype":"F32","shape":[],"data_offsets":[0,4]}}"#
    };
    let mut b = (header.len() as u64).to_le_bytes().to_vec();
    b.extend(header.as_bytes());
    b.extend([0; 4]);
    std::fs::write(path, b).unwrap();
}
#[tokio::test(flavor = "multi_thread")]
async fn lifecycle_acceptance_races_and_observational_reads() {
    let dir = tempfile::tempdir().unwrap();
    let files = FileService::new(dir.path()).await.unwrap();
    let mut s = Session::open(dir.path().join("metadata.sqlite"))
        .await
        .unwrap();
    let m = ModelService::new();
    let mut k = Kernel::new();
    k.register(Arc::new(FileOwner)).unwrap();
    k.register(Arc::new(ModelOwner)).unwrap();
    k.initialize(&mut s).await.unwrap();
    files.initialize(&mut s).await.unwrap();
    m.initialize(&mut s).await.unwrap();
    let path = dir.path().join("misleading.png");
    fixture(&path, true);
    let original = std::fs::read(&path).unwrap();
    let f = files.admit(&k, &mut s, &path).await.unwrap();
    assert!(matches!(
        m.recognize(&files, &mut s, f.id).await.outcome,
        RecognitionOutcome::Match
    ));
    let id = m.create(&k, &mut s).await.unwrap();
    assert!(m.read(&mut s, id).await.unwrap().facts.is_none());
    assert!(matches!(
        m.view(&k, &mut s, id).await.unwrap().context,
        Ok(InputContext::Unmounted)
    ));
    let e = k.create_entity(&mut s).await.unwrap();
    let fm = Membership {
        entity: e,
        kind: FILE_KIND,
        component: f.id.component(),
    };
    let mm = Membership {
        entity: e,
        kind: MODEL_KIND,
        component: id.component(),
    };
    k.attach(&mut s, fm).await.unwrap();
    k.attach(&mut s, mm).await.unwrap();
    assert!(matches!(
        m.inspect(&k, &files, &mut s, id).await.unwrap(),
        ApplyOutcome::Accepted(_)
    ));
    let accepted = m.read(&mut s, id).await.unwrap();
    assert!(accepted.facts.as_ref().unwrap().declarations.is_some());
    assert!(
        k.delete_component(&mut s, MODEL_KIND, id.component())
            .await
            .is_err()
    );
    let pending = m.prepare(&k, &files, &mut s, id).await.unwrap();
    let competing = m.prepare(&k, &files, &mut s, id).await.unwrap();
    m.apply(&k, &mut s, competing).await.unwrap();
    assert_eq!(
        m.apply(&k, &mut s, pending).await.unwrap(),
        ApplyOutcome::RejectedNewerAttempt
    );
    let pending = m.prepare(&k, &files, &mut s, id).await.unwrap();
    k.detach(&mut s, fm).await.unwrap();
    assert_eq!(
        m.apply(&k, &mut s, pending).await.unwrap(),
        ApplyOutcome::RejectedContextChanged
    );
    m.inspect(&k, &files, &mut s, id).await.unwrap();
    let failed = m.read(&mut s, id).await.unwrap();
    assert_eq!(failed.facts, accepted.facts);
    assert!(failed.last_failure.is_some());
    k.attach(&mut s, fm).await.unwrap();
    assert!(matches!(
        m.view(&k, &mut s, id).await.unwrap().comparison,
        Some(InputComparison::Matching(_))
    ));
    assert_eq!(m.read(&mut s, id).await.unwrap(), failed);
    fixture(&path, false);
    let f2 = files.admit(&k, &mut s, &path).await.unwrap();
    k.detach(&mut s, fm).await.unwrap();
    let fm2 = Membership {
        entity: e,
        kind: FILE_KIND,
        component: f2.id.component(),
    };
    k.attach(&mut s, fm2).await.unwrap();
    assert!(matches!(
        m.view(&k, &mut s, id).await.unwrap().comparison,
        Some(InputComparison::Changed { .. })
    ));
    m.inspect(&k, &files, &mut s, id).await.unwrap();
    let replaced = m.read(&mut s, id).await.unwrap();
    assert!(replaced.last_failure.is_none());
    assert!(replaced.facts.unwrap().declarations.is_none());
    let input = files.local_path(&mut s, f.id).await.unwrap();
    assert_eq!(std::fs::read(input.path()).unwrap(), original);
    k.delete_entity(&mut s, e).await.unwrap();
    assert!(m.read(&mut s, id).await.is_ok());
    k.delete_component(&mut s, MODEL_KIND, id.component())
        .await
        .unwrap();
    assert!(matches!(
        m.read(&mut s, id).await,
        Err(ModelError::MissingRecord(_))
    ));
}
#[tokio::test(flavor = "multi_thread")]
async fn corruption_and_provisional_rollback() {
    use diesel_async::RunQueryDsl;
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::open(dir.path().join("db")).await.unwrap();
    let mut k = Kernel::new();
    k.register(Arc::new(ModelOwner)).unwrap();
    k.initialize(&mut s).await.unwrap();
    let m = ModelService::new();
    m.initialize(&mut s).await.unwrap();
    let id = m.create(&k, &mut s).await.unwrap();
    for payload in [
        "not json",
        r#"{"version":2,"basis":null,"facts":null,"last_failure":null}"#,
    ] {
        let payload = payload.to_string();
        s.transaction::<(), ModelError, _>(move |c| {
            Box::pin(async move {
                diesel::sql_query("UPDATE locus_models SET payload = ?")
                    .bind::<diesel::sql_types::Text, _>(payload)
                    .execute(c.connection())
                    .await?;
                Ok(())
            })
        })
        .await
        .unwrap();
        assert!(matches!(
            m.read(&mut s, id).await,
            Err(ModelError::Corrupt(_))
        ));
    }
    let k2 = k.clone();
    let result = s
        .transaction::<(), ModelError, _>(move |c| {
            Box::pin(async move {
                let id = ModelService::create_in(&k2, c).await?;
                assert!(ModelService::read_in(c, id).await.is_ok());
                Err(ModelError::ContextChanged)
            })
        })
        .await;
    assert!(result.is_err());
}
#[tokio::test(flavor = "multi_thread")]
async fn actual_commit_failure_preserves_unknown_outcome_and_prior_record() {
    use diesel_async::SimpleAsyncConnection;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db");
    let mut s = Session::open(&path).await.unwrap();
    let mut k = Kernel::new();
    k.register(Arc::new(ModelOwner)).unwrap();
    k.initialize(&mut s).await.unwrap();
    let m = ModelService::new();
    m.initialize(&mut s).await.unwrap();
    let id = m.create(&k, &mut s).await.unwrap();
    let before = m.read(&mut s, id).await.unwrap();
    s.transaction::<(),ModelError,_>(|c|Box::pin(async move{c.connection().batch_execute("CREATE TABLE fixture_parent (id INTEGER PRIMARY KEY); CREATE TABLE fixture_child (parent INTEGER REFERENCES fixture_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER uncertain_model AFTER UPDATE ON locus_models BEGIN INSERT INTO fixture_child VALUES (1); END;").await?;Ok(())})).await.unwrap();
    let files = FileService::new(dir.path()).await.unwrap();
    let error = m.inspect(&k, &files, &mut s, id).await.unwrap_err();
    assert!(matches!(
        error,
        ModelError::Store(locus_store::api::StoreError::CommitOutcomeUnknown(_))
    ));
    assert!(!s.is_usable());
    let mut reopened = Session::open(path).await.unwrap();
    assert_eq!(m.read(&mut reopened, id).await.unwrap(), before);
}
