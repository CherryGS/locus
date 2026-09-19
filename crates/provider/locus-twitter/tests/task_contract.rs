#![allow(clippy::expect_used, clippy::unwrap_used)]
mod support;
use locus_store::api::TaskDatabase;
use locus_task::api::{TaskQueue, TaskState};
use locus_twitter::api::{TwitterService, TwitterSnapshot, WriteOutcome};
use support::{Fixture, snapshot};

#[tokio::test(flavor = "multi_thread")]
async fn task_results_preserve_source_revision_conflicts_and_earlier_commits() {
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        let fixture = Fixture::new().await;
        let queue = TaskQueue::new();
        let database = TaskDatabase::open(&queue, &fixture.database).await.unwrap();
        let kernel = fixture.kernel.clone();
        let db = database.clone();
        let files = fixture.files.clone();
        let missing = fixture.directory.path().join("missing");
        let id = queue
            .submit("snapshot", move |task| async move {
                let mut session = db.session(&task).await.unwrap();
                let id = TwitterService::new()
                    .create(&kernel, &mut session, snapshot())
                    .await
                    .unwrap();
                // A subsequent failed File copy cannot roll back the independent snapshot.
                assert!(files.admit(&kernel, &mut session, missing).await.is_err());
                id
            })
            .unwrap()
            .result()
            .await
            .unwrap();
        let task = queue
            .submit("revision guard", move |task| async move {
                let mut session = database.session(&task).await.unwrap();
                let twitter = TwitterService::new();
                let original = twitter.read(&mut session, id).await.unwrap();
                assert_eq!(original.revision, 0);
                assert!(
                    twitter
                        .replace(&mut session, id, 0, TwitterSnapshot::default())
                        .await
                        .is_err()
                );
                assert_eq!(twitter.read(&mut session, id).await.unwrap(), original);
                assert!(matches!(
                    twitter
                        .replace(&mut session, id, 0, snapshot())
                        .await
                        .unwrap(),
                    WriteOutcome::Accepted(_)
                ));
                twitter.replace(&mut session, id, 0, snapshot()).await
            })
            .unwrap();
        let observation = task.subscribe();
        assert!(matches!(
            task.result().await.unwrap().unwrap(),
            WriteOutcome::RejectedRevisionChanged
        ));
        // Completed means the typed operation ended; it does not turn rejection into success.
        assert_eq!(observation.borrow().state, TaskState::Completed);
    })
    .await
    .unwrap();
}
