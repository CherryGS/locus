use super::*;

#[tokio::test(flavor = "multi_thread")]
async fn real_task_consumer_retains_domain_results_in_one_shared_database() {
    tokio::time::timeout(std::time::Duration::from_secs(15), async {
        let root = tempfile::tempdir().unwrap();
        let results = demonstrate(root.path()).await.unwrap();
        assert_eq!(results.len(), 2);
        assert_ne!(results[0].file.id, results[1].file.id);
        assert_ne!(results[0].twitter, results[1].twitter);
        let mut session =
            locus_store::api::Session::open(root.path().join("library/metadata.sqlite"))
                .await
                .unwrap();
        let files = FileService::new(root.path().join("library")).await.unwrap();
        let twitter = TwitterService::new();
        for imported in results {
            assert_eq!(
                files.read(&mut session, imported.file.id).await.unwrap(),
                imported.file
            );
            let snapshot = twitter.read(&mut session, imported.twitter).await.unwrap();
            assert!(snapshot.snapshot.post_id.is_some());
            assert_eq!(snapshot.revision, 0);
            match imported.interpretation {
                ApplyOutcome::Accepted(record) => {
                    assert!(record.last_failure.is_none());
                    assert!(record.facts.is_some());
                    assert_eq!(record.basis, Some(imported.file.id));
                }
                rejected => panic!("unexpected interpretation {rejected:?}"),
            }
            assert!(imported.preview.path.is_file());
        }
        assert!(root.path().join("synthetic.png").is_file());
    })
    .await
    .unwrap();
}
