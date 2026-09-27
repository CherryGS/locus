use super::{
    attempt::{ApplyOutcome, PreparedInspection},
    workflow::finish_worker,
};
use crate::{
    error::{FailureCode, ModelError},
    identity::MODEL_KIND,
    input::InputContext,
    owner::ModelOwner,
    service::ModelService,
};
use locus_core::api::{Kernel, Membership};
use locus_file::api::{CurrentInput, FILE_KIND, FileOwner, FileService};
use locus_store::api::Session;
use std::sync::Arc;
#[tokio::test(flavor = "multi_thread")]
async fn failed_worker_retains_complete_group_and_competing_attempt_rejects_it() {
    let dir = tempfile::tempdir().unwrap();
    let files = FileService::new(dir.path()).await.unwrap();
    let mut s = Session::open(dir.path().join("db")).await.unwrap();
    let mut k = Kernel::new();
    k.register(Arc::new(FileOwner)).unwrap();
    k.register(Arc::new(ModelOwner)).unwrap();
    locus_migration::api::migrate(&mut s).await.unwrap();
    let m = ModelService::new();
    locus_migration::api::migrate(&mut s).await.unwrap();
    let p = dir.path().join("weight");
    let mut b = 2u64.to_le_bytes().to_vec();
    b.extend(b"{}");
    std::fs::write(&p, b).unwrap();
    let f = files.admit(&k, &mut s, p).await.unwrap();
    let e = k.create_entity(&mut s).await.unwrap();
    let id = m.create(&k, &mut s).await.unwrap();
    for membership in [
        Membership {
            entity: e,
            kind: FILE_KIND,
            component: f.id.component(),
        },
        Membership {
            entity: e,
            kind: MODEL_KIND,
            component: id.component(),
        },
    ] {
        k.attach(&mut s, membership).await.unwrap();
    }
    let observed = InputContext::Hosted {
        host: e,
        input: CurrentInput::File(f.id),
    };
    for prior_success in [false, true] {
        if prior_success {
            m.inspect(&k, &files, &mut s, id).await.unwrap();
        }
        let before = m.read(&mut s, id).await.unwrap();
        let result =
            finish_worker(tokio::task::spawn_blocking(|| panic!("test worker panic")).await);
        let prepared = PreparedInspection {
            id,
            revision: before.revision,
            observed,
            result,
        };
        m.apply(&k, &mut s, prepared).await.unwrap();
        let after = m.read(&mut s, id).await.unwrap();
        assert_eq!(after.facts, before.facts);
        assert_eq!(after.basis, before.basis);
        assert_eq!(after.last_failure.unwrap().code, FailureCode::Worker);
    }
    let before = m.read(&mut s, id).await.unwrap();
    let prepared = m.prepare(&k, &files, &mut s, id).await.unwrap();
    let result =
        finish_worker(tokio::task::spawn_blocking(|| panic!("test competing worker panic")).await);
    m.apply(
        &k,
        &mut s,
        PreparedInspection {
            id,
            revision: before.revision,
            observed,
            result,
        },
    )
    .await
    .unwrap();
    assert_eq!(
        m.apply(&k, &mut s, prepared).await.unwrap(),
        ApplyOutcome::RejectedNewerAttempt
    );
    // Provisional successful acceptance rolls back and cannot clear the failure.
    let before = m.read(&mut s, id).await.unwrap();
    let prepared = m.prepare(&k, &files, &mut s, id).await.unwrap();
    let k2 = k.clone();
    assert!(
        s.transaction::<(), ModelError, _>(move |c| Box::pin(async move {
            ModelService::apply_in(&k2, c, prepared).await?;
            Err(ModelError::ContextChanged)
        }))
        .await
        .is_err()
    );
    assert_eq!(m.read(&mut s, id).await.unwrap(), before);
}
