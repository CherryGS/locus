#![allow(clippy::expect_used, clippy::unwrap_used)]
mod support;
use locus_core::api::{ComponentId, CoreError};
use locus_file::api::{CurrentInput, FileError, FileId, InputComparison};
use locus_store::api::Session;
use locus_twitter::api::*;
use support::*;

#[tokio::test(flavor = "multi_thread")]
async fn explicit_association_needs_current_record_but_no_bytes_or_media() {
    let mut f = Fixture::new().await;
    let (entity, id) = f.component().await;
    assert!(matches!(
        f.twitter
            .prepare_association(
                &f.kernel,
                &mut f.session,
                id,
                FileId::from_component(ComponentId::new())
            )
            .await,
        Err(TwitterError::AssociationContext)
    ));
    let file = f.file(entity, "uninterpretable").await;
    let view = f.twitter.view(&f.kernel, &mut f.session, id).await.unwrap();
    assert!(
        matches!(view.applicability,TwitterApplicability::Input { comparison:InputComparison::Incomplete {basis:None,current:CurrentInput::File(v)},file_error:None,.. } if v==file)
    );
    let location = f.files.read(&mut f.session, file).await.unwrap();
    std::fs::remove_file(f.files.root().join(location.relative_path)).unwrap();
    assert!(f.files.open(&mut f.session, file).await.is_err());
    let record = f.associate(id, file).await;
    assert_eq!(record.basis, Some(file));
    assert_eq!(record.revision, 1);
    assert!(
        matches!(f.twitter.view(&f.kernel,&mut f.session,id).await.unwrap().applicability,TwitterApplicability::Input {comparison:InputComparison::Matching(v),file_error:None,..} if v==file)
    );
    let token = f.prepare(id, file).await;
    execute(&mut f.session, "DELETE FROM locus_files".into()).await;
    assert_eq!(
        f.twitter
            .associate(&f.kernel, &mut f.session, token)
            .await
            .unwrap(),
        WriteOutcome::RejectedContextChanged
    );
    assert!(
        matches!(f.twitter.prepare_association(&f.kernel,&mut f.session,id,file).await,Err(TwitterError::File(FileError::MissingRecord(v))) if v==file)
    );
    let view = f.twitter.view(&f.kernel, &mut f.session, id).await.unwrap();
    assert_eq!(view.record, record);
    assert!(
        matches!(view.applicability,TwitterApplicability::Input {comparison:InputComparison::Matching(v),file_error:Some(FileError::MissingRecord(w)),..} if v==file && w==file)
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn replacement_clears_basis_and_combined_write_is_one_accepted_state() {
    let mut f = Fixture::new().await;
    let (entity, id) = f.component().await;
    let file = f.file(entity, "input").await;
    let associated = f.associate(id, file).await;
    let mut replacement = snapshot();
    replacement.text = Some("new".into());
    let token = f.prepare(id, file).await;
    let invalid = TwitterSnapshot::default();
    assert!(matches!(
        f.twitter
            .replace_and_associate(&f.kernel, &mut f.session, token, invalid)
            .await,
        Err(TwitterError::Invalid(_))
    ));
    assert_eq!(
        f.twitter.read(&mut f.session, id).await.unwrap(),
        associated
    );
    assert_eq!(
        f.twitter
            .replace(&mut f.session, id, 0, replacement.clone())
            .await
            .unwrap(),
        WriteOutcome::RejectedRevisionChanged
    );
    let replaced = f
        .twitter
        .replace(&mut f.session, id, 1, replacement.clone())
        .await
        .unwrap();
    assert!(
        matches!(replaced,WriteOutcome::Accepted(record) if record.id==id && record.revision==2 && record.basis.is_none())
    );
    let token = f.prepare(id, file).await;
    let combined = f
        .twitter
        .replace_and_associate(&f.kernel, &mut f.session, token, snapshot())
        .await
        .unwrap();
    assert!(
        matches!(combined,WriteOutcome::Accepted(record) if record.revision==3 && record.basis==Some(file))
    );
    assert_eq!(
        f.twitter
            .read(&mut f.session, id)
            .await
            .unwrap()
            .snapshot
            .text,
        None
    );
    let token = f.prepare(id, file).await;
    let other = f
        .twitter
        .replace(&mut f.session, id, 3, replacement)
        .await
        .unwrap();
    assert_eq!(
        f.twitter
            .associate(&f.kernel, &mut f.session, token)
            .await
            .unwrap(),
        WriteOutcome::RejectedRevisionChanged
    );
    let WriteOutcome::Accepted(expected) = other else {
        panic!()
    };
    assert_eq!(f.twitter.read(&mut f.session, id).await.unwrap(), *expected);
}

#[tokio::test(flavor = "multi_thread")]
async fn competing_connection_file_and_host_changes_reject_stale_tokens() {
    let mut f = Fixture::new().await;
    let (entity, id) = f.component().await;
    let file = f.file(entity, "first").await;
    let accepted = f.associate(id, file).await;
    let mut other = Session::open(&f.database).await.unwrap();
    let token = f.prepare(id, file).await;
    f.kernel
        .detach(&mut other, file_membership(entity, file))
        .await
        .unwrap();
    let changed_file = f.file(entity, "second").await;
    assert_eq!(
        f.twitter
            .replace_and_associate(
                &f.kernel,
                &mut f.session,
                token,
                TwitterSnapshot {
                    text: Some("stale".into()),
                    ..snapshot()
                }
            )
            .await
            .unwrap(),
        WriteOutcome::RejectedContextChanged
    );
    assert_eq!(f.twitter.read(&mut f.session, id).await.unwrap(), accepted);
    assert!(matches!(
        f.twitter
            .prepare_association(&f.kernel, &mut f.session, id, file)
            .await,
        Err(TwitterError::AssociationContext)
    ));
    let token = f.prepare(id, changed_file).await;
    let host2 = f.kernel.create_entity(&mut other).await.unwrap();
    f.kernel
        .detach(&mut other, membership(entity, id))
        .await
        .unwrap();
    f.kernel
        .attach(&mut other, membership(host2, id))
        .await
        .unwrap();
    f.kernel
        .detach(&mut other, file_membership(entity, changed_file))
        .await
        .unwrap();
    f.kernel
        .attach(&mut other, file_membership(host2, changed_file))
        .await
        .unwrap();
    assert_eq!(
        f.twitter
            .associate(&f.kernel, &mut f.session, token)
            .await
            .unwrap(),
        WriteOutcome::RejectedContextChanged
    );
    let token = f.prepare(id, changed_file).await;
    f.twitter
        .replace(&mut other, id, accepted.revision, snapshot())
        .await
        .unwrap();
    assert_eq!(
        f.twitter
            .associate(&f.kernel, &mut f.session, token)
            .await
            .unwrap(),
        WriteOutcome::RejectedRevisionChanged
    );
    let before = f.twitter.read(&mut f.session, id).await.unwrap();
    let token = f.prepare(id, changed_file).await;
    f.kernel.delete_entity(&mut other, host2).await.unwrap();
    assert_eq!(
        f.twitter
            .associate(&f.kernel, &mut f.session, token)
            .await
            .unwrap(),
        WriteOutcome::RejectedContextChanged
    );
    assert_eq!(f.twitter.read(&mut f.session, id).await.unwrap(), before);
}

#[tokio::test(flavor = "multi_thread")]
async fn retained_views_follow_actual_membership_without_old_file_fallback() {
    let mut f = Fixture::new().await;
    let (entity, id) = f.component().await;
    let file = f.file(entity, "first").await;
    let record = f.associate(id, file).await;
    f.kernel
        .detach(&mut f.session, file_membership(entity, file))
        .await
        .unwrap();
    assert!(
        matches!(f.twitter.view(&f.kernel,&mut f.session,id).await.unwrap().applicability,TwitterApplicability::Input {comparison:InputComparison::Incomplete {basis:Some(b),current:CurrentInput::MissingSlot(e)},..} if b==file && e==entity)
    );
    let new_file = f.file(entity, "second").await;
    assert!(
        matches!(f.twitter.view(&f.kernel,&mut f.session,id).await.unwrap().applicability,TwitterApplicability::Input {comparison:InputComparison::Changed {basis,current},..} if basis==file && current==new_file)
    );
    f.kernel
        .detach(&mut f.session, file_membership(entity, new_file))
        .await
        .unwrap();
    f.kernel
        .attach(&mut f.session, file_membership(entity, file))
        .await
        .unwrap();
    assert!(
        matches!(f.twitter.view(&f.kernel,&mut f.session,id).await.unwrap().applicability,TwitterApplicability::Input {comparison:InputComparison::Matching(v),..} if v==file)
    );
    f.kernel
        .detach(&mut f.session, membership(entity, id))
        .await
        .unwrap();
    assert!(matches!(
        f.twitter
            .view(&f.kernel, &mut f.session, id)
            .await
            .unwrap()
            .applicability,
        TwitterApplicability::Unmounted
    ));
    assert_eq!(f.twitter.read(&mut f.session, id).await.unwrap(), record);
    assert!(
        f.twitter
            .entity_view(&f.kernel, &mut f.session, entity)
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn overflow_and_real_read_errors_preserve_the_previous_snapshot() {
    let mut f = Fixture::new().await;
    let (entity, id) = f.component().await;
    let file = f.file(entity, "input").await;
    execute(
        &mut f.session,
        format!("UPDATE locus_twitter_snapshots SET revision={}", i64::MAX),
    )
    .await;
    let before = f.twitter.read(&mut f.session, id).await.unwrap();
    let token = f.prepare(id, file).await;
    assert!(
        matches!(f.twitter.associate(&f.kernel,&mut f.session,token).await,Err(TwitterError::RevisionExhausted(v)) if v==id)
    );
    let token = f.prepare(id, file).await;
    assert!(matches!(
        f.twitter
            .replace_and_associate(&f.kernel, &mut f.session, token, snapshot())
            .await,
        Err(TwitterError::RevisionExhausted(_))
    ));
    assert!(matches!(
        f.twitter
            .replace(&mut f.session, id, i64::MAX, snapshot())
            .await,
        Err(TwitterError::RevisionExhausted(_))
    ));
    assert_eq!(f.twitter.read(&mut f.session, id).await.unwrap(), before);
    let token = f.prepare(id, file).await;
    execute(&mut f.session, "DROP TABLE locus_files".into()).await;
    assert!(matches!(
        f.twitter.associate(&f.kernel, &mut f.session, token).await,
        Err(TwitterError::File(FileError::Database(_)))
    ));
    assert_eq!(f.twitter.read(&mut f.session, id).await.unwrap(), before);
    assert!(matches!(
        f.twitter
            .entity_view(&f.kernel, &mut f.session, locus_core::api::EntityId::new())
            .await,
        Err(TwitterError::Core(CoreError::MissingEntity(_)))
    ));
}
