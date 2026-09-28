#![allow(clippy::expect_used, clippy::unwrap_used)]
use super::{Server, ServerConfig};
use crate::api::{dto::*, tag::dto::*};
use locus_filter::api::{compile, native_source};
async fn app(root: &std::path::Path) -> Server {
    Server::bind(ServerConfig::new(
        "test-credential-with-at-least-32-characters".into(),
        root.join("library"),
    ))
    .await
    .unwrap()
}
async fn write(s: &Server, c: TagChange) -> MutationOutcome {
    s.state
        .tag_write(uuid::Uuid::now_v7().to_string(), c)
        .await
        .unwrap()
}
async fn create(s: &Server, name: &str) -> TagRecord {
    match write(s, TagChange::Create { name: name.into() }).await {
        MutationOutcome::TagSaved { tag } => tag,
        o => panic!("{o:?}"),
    }
}
async fn ids(s: &Server, source: &str) -> Vec<u8> {
    s.state
        .search
        .as_ref()
        .unwrap()
        .query_program(compile(native_source(source)).unwrap())
        .await
        .unwrap()
        .bytes
        .to_vec()
}
async fn expected(s: &Server, source: &str, subjects: &[String]) {
    let bytes = ids(s, source).await;
    let mut actual = bytes
        .chunks_exact(16)
        .map(|b| {
            locus_core::api::EntityId::from_bytes(b)
                .unwrap()
                .to_string()
        })
        .collect::<Vec<_>>();
    let mut expected = subjects.to_vec();
    actual.sort();
    expected.sort();
    assert_eq!(actual, expected, "query: {source}");
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn registered_tags_align_search_keep_entities_and_survive_restart() {
    let root = tempfile::tempdir().unwrap();
    let s = app(root.path()).await;
    let mut subjects = Vec::new();
    for _ in 0..3 {
        let MutationOutcome::EntityCreated { entity_id } = s
            .state
            .create_entity(uuid::Uuid::now_v7().to_string())
            .await
            .unwrap()
        else {
            panic!()
        };
        subjects.push(entity_id)
    }
    let cat = create(&s, "cat").await;
    let upper = create(&s, "Cat").await;
    for e in &subjects[..2] {
        assert!(matches!(
            write(
                &s,
                TagChange::Add {
                    entity_id: e.clone(),
                    tag_id: cat.id.clone()
                }
            )
            .await,
            MutationOutcome::TagAssignment { changed: true, .. }
        ));
    }
    write(
        &s,
        TagChange::Add {
            entity_id: subjects[1].clone(),
            tag_id: upper.id.clone(),
        },
    )
    .await;
    assert_eq!(ids(&s, "tag_names_exact:cat").await.len(), 32);
    assert_eq!(ids(&s, "tag_names_exact:Cat").await.len(), 16);
    assert_eq!(ids(&s, &format!("tag_ids:\"{}\"", cat.id)).await.len(), 32);
    assert_eq!(
        ids(&s, "entity_id:* AND NOT tag_names_exact:cat")
            .await
            .len(),
        16
    );
    expected(&s, "tag_names_exact:cat", &subjects[..2]).await;
    expected(&s, "tag_names_exact:Cat", &subjects[1..2]).await;
    expected(
        &s,
        "entity_id:* AND NOT tag_names_exact:cat",
        &subjects[2..],
    )
    .await;
    let fixed = ids(&s, "tag_names_exact:cat").await;
    let MutationOutcome::TagSaved { tag: renamed } = write(
        &s,
        TagChange::Rename {
            id: cat.id.clone(),
            revision: cat.revision.clone(),
            name: "kitten".into(),
        },
    )
    .await
    else {
        panic!()
    };
    assert_eq!(ids(&s, "tag_names_exact:cat").await.len(), 0);
    assert_eq!(ids(&s, "tag_names_exact:kitten").await.len(), 32);
    assert_eq!(fixed.len(), 32);
    expected(&s, "tag_names_exact:kitten", &subjects[..2]).await;
    assert!(matches!(
        write(
            &s,
            TagChange::Delete {
                id: cat.id.clone(),
                revision: cat.revision
            }
        )
        .await,
        MutationOutcome::TagFailed {
            uncertain: false,
            ..
        }
    ));
    write(
        &s,
        TagChange::Delete {
            id: cat.id.clone(),
            revision: renamed.revision,
        },
    )
    .await;
    assert_eq!(ids(&s, &format!("tag_ids:\"{}\"", cat.id)).await.len(), 0);
    assert_eq!(ids(&s, "tag_names_exact:Cat").await.len(), 16);
    assert_eq!(ids(&s, "tag_names:*").await.len(), 16);
    assert_eq!(ids(&s, "entity_id:*").await.len(), 48);
    expected(&s, "tag_names_exact:Cat", &subjects[1..2]).await;
    expected(
        &s,
        "NOT tag_names:*",
        &[subjects[0].clone(), subjects[2].clone()],
    )
    .await;
    expected(&s, "entity_id:*", &subjects).await;
    s.close_admission();
    s.state.wait_drained().await;
    drop(s);
    let s = app(root.path()).await;
    assert_eq!(s.state.tags().await.unwrap(), vec![upper]);
    assert_eq!(ids(&s, "tag_names_exact:Cat").await.len(), 16);
    s.close_admission();
    s.state.wait_drained().await;
}
#[tokio::test(flavor = "multi_thread")]
async fn tag_delivery_auth_run_binding_and_recovery() {
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;
    let root = tempfile::tempdir().unwrap();
    let s = app(root.path()).await;
    for (auth, run, expected) in [(false, true, 401), (true, false, 409)] {
        let mut r = Request::builder().uri("/api/v1/tags").header(
            "x-locus-run",
            if run {
                s.state.run_id.as_str()
            } else {
                "wrong"
            },
        );
        if auth {
            r = r.header("authorization", format!("Bearer {}", s.state.credential));
        }
        assert_eq!(
            s.router()
                .oneshot(r.body(Body::empty()).unwrap())
                .await
                .unwrap()
                .status()
                .as_u16(),
            expected
        );
    }
    let db = s.state.library.database.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    let (release, wait) = tokio::sync::oneshot::channel();
    let holder = s
        .state
        .queue
        .submit("hold", move |t| async move {
            let _p = db.protect(&t).await.unwrap();
            tx.send(()).unwrap();
            wait.await.unwrap();
        })
        .unwrap();
    rx.await.unwrap();
    let id = uuid::Uuid::now_v7().to_string();
    let change = TagChange::Create {
        name: "recover me".into(),
    };
    let state = s.state.clone();
    let request = id.clone();
    let captured = change.clone();
    let waiter = tokio::spawn(async move { state.tag_write(request, captured).await });
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while s.state.submission(&id).is_err() {
            tokio::task::yield_now().await
        }
    })
    .await
    .unwrap();
    waiter.abort();
    release.send(()).unwrap();
    holder.result().await.unwrap();
    let outcome = s.state.tag_write(id.clone(), change).await.unwrap();
    assert!(matches!(outcome, MutationOutcome::TagSaved { .. }));
    assert_eq!(
        s.state.submission(&id).unwrap(),
        Submission::DirectComplete { outcome }
    );
    assert!(
        s.state
            .tag_write(
                id,
                TagChange::Create {
                    name: "different".into()
                }
            )
            .await
            .is_err()
    );
    assert_eq!(s.state.tags().await.unwrap().len(), 1);
    s.close_admission();
    s.state.wait_drained().await;
}
