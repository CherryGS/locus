#![allow(clippy::expect_used, clippy::unwrap_used)]
use crate::{
    error::MigrationError,
    runtime::execute,
    step::{Input, Step, fingerprint},
    steps::STEPS,
};
use diesel::{
    QueryableByName, sql_query,
    sql_types::{BigInt, Text},
};
use diesel_async::{RunQueryDsl, SimpleAsyncConnection};
use locus_store::api::{Context, Session, StoreError, TransactionFuture};
use std::{collections::BTreeSet, path::Path};

#[derive(QueryableByName)]
struct Count {
    #[diesel(sql_type=BigInt)]
    count: i64,
}
#[derive(QueryableByName)]
struct Value {
    #[diesel(sql_type=Text)]
    value: String,
}
async fn sql(s: &mut Session, text: &str) {
    let text = text.to_owned();
    s.transaction::<_, MigrationError, _>(move |c| {
        Box::pin(async move {
            c.connection().batch_execute(&text).await?;
            Ok(())
        })
    })
    .await
    .unwrap();
}
async fn count(s: &mut Session, text: &str) -> i64 {
    let text = text.to_owned();
    s.transaction::<_, MigrationError, _>(move |c| {
        Box::pin(async move {
            Ok(sql_query(text)
                .get_result::<Count>(c.connection())
                .await?
                .count)
        })
    })
    .await
    .unwrap()
}
fn seed(c: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        c.connection()
            .batch_execute(
                "CREATE TABLE fixture(value TEXT); INSERT INTO fixture VALUES('{\"old\":7}')",
            )
            .await?;
        Ok(())
    })
}
fn convert(c: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        let row = sql_query("SELECT value FROM fixture")
            .get_result::<Value>(c.connection())
            .await?;
        let value: serde_json::Value = serde_json::from_str(&row.value).unwrap();
        let updated = serde_json::json!({"retained":value["old"],"added":true});
        sql_query("UPDATE fixture SET value=?")
            .bind::<Text, _>(updated.to_string())
            .execute(c.connection())
            .await?;
        c.connection()
            .batch_execute("CREATE TABLE converted(value INTEGER)")
            .await?;
        Ok(())
    })
}
fn fail(c: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        convert(c).await?;
        Err(MigrationError::Incompatible(
            "test failure after mutation".into(),
        ))
    })
}
fn uncertain(c: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        convert(c).await?;
        c.connection().batch_execute("CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED); INSERT INTO child VALUES(1)").await?;
        Ok(())
    })
}
static PENDING_ENTERED: tokio::sync::Notify = tokio::sync::Notify::const_new();
fn pending(c: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        convert(c).await?;
        PENDING_ENTERED.notify_one();
        std::future::pending().await
    })
}
const INPUTS: &[Input] = &[Input {
    path: "test",
    contents: "frozen fixture",
}];
const SEED: Step = Step {
    id: 1,
    name: "seed",
    inputs: INPUTS,
    run: seed,
};
const CONVERT: Step = Step {
    id: 2,
    name: "convert",
    inputs: INPUTS,
    run: convert,
};
const GOOD: &[Step] = &[SEED, CONVERT];
const FAIL: &[Step] = &[
    SEED,
    Step {
        run: fail,
        ..CONVERT
    },
];
const UNCERTAIN: &[Step] = &[
    SEED,
    Step {
        run: uncertain,
        ..CONVERT
    },
];
const PENDING: &[Step] = &[
    SEED,
    Step {
        run: pending,
        ..CONVERT
    },
];

#[test]
fn fingerprints_cover_rust_sql_helpers_and_are_checkout_and_append_stable() {
    let source = |contents| Input {
        path: "steps/body.rs",
        contents,
    };
    assert_eq!(
        fingerprint(&[source("a\nb\n")]),
        fingerprint(&[source("a\r\nb\r\n")])
    );
    for path in ["body.rs", "data.sql", "helper.rs"] {
        assert_ne!(
            fingerprint(&[Input {
                path,
                contents: "before"
            }]),
            fingerprint(&[Input {
                path,
                contents: "after"
            }])
        );
    }
    assert_eq!(GOOD[0].checksum(), FAIL[0].checksum());
    assert_ne!(
        fingerprint(&[Input {
            path: "ab",
            contents: "c"
        }]),
        fingerprint(&[Input {
            path: "a",
            contents: "bc"
        }])
    );
}
#[test]
fn every_historical_source_and_resource_is_declared() {
    fn files(root: &Path, here: &Path, output: &mut BTreeSet<String>) {
        for entry in std::fs::read_dir(here).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                files(root, &path, output);
            } else {
                let relative = path
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                if relative != "steps/mod.rs" && relative != "steps/catalog.rs" {
                    output.insert(relative);
                }
            }
        }
    }
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut actual = BTreeSet::new();
    files(&root, &root.join("steps"), &mut actual);
    let declared = STEPS
        .iter()
        .flat_map(|s| s.inputs.iter().map(|i| i.path.to_owned()))
        .collect();
    assert_eq!(
        actual, declared,
        "all historical helpers/resources belong under steps and must be fingerprinted"
    );
    for step in STEPS {
        assert!(step.inputs.iter().any(|i| i.path.ends_with(".rs")));
        for input in step.inputs {
            assert_eq!(
                std::fs::read_to_string(root.join(input.path))
                    .unwrap()
                    .replace("\r\n", "\n"),
                input.contents.replace("\r\n", "\n")
            );
        }
    }
}
#[tokio::test(flavor = "multi_thread")]
async fn fresh_schema_reopens_without_replay_and_suffix_appends() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("library.sqlite");
    let mut s = Session::open(&path).await.unwrap();
    crate::runtime::migrate(&mut s).await.unwrap();
    assert_eq!(
        count(
            &mut s,
            "SELECT count(*) AS count FROM locus_migration_comm_history"
        )
        .await,
        STEPS.len() as i64
    );
    assert_eq!(
        count(
            &mut s,
            "SELECT count(*) AS count FROM sqlite_schema WHERE type='table' AND name LIKE 'locus_%'"
        )
        .await,
        17
    );
    assert_eq!(
        count(
            &mut s,
            "SELECT count(*) AS count FROM sqlite_schema WHERE name LIKE '%_schema'"
        )
        .await,
        0
    );
    sql(
        &mut s,
        "UPDATE locus_migration_comm_history SET name='diagnostic',applied_at='retained'",
    )
    .await;
    drop(s);
    let mut s = Session::open(&path).await.unwrap();
    crate::runtime::migrate(&mut s).await.unwrap();
    assert_eq!(
        count(
            &mut s,
            "SELECT count(*) AS count FROM locus_migration_comm_history WHERE applied_at='retained'"
        )
        .await,
        STEPS.len() as i64
    );
    let mut s = Session::memory().await.unwrap();
    execute(&mut s, &[SEED]).await.unwrap();
    execute(&mut s, GOOD).await.unwrap();
    assert_eq!(
        count(&mut s, "SELECT count(*) AS count FROM converted").await,
        0
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn common_prefix_conversion_preserves_precision_and_rejects_malformed_selected_data() {
    let mut session = Session::memory().await.unwrap();
    execute(&mut session, &STEPS[..10]).await.unwrap();
    let prefix: Vec<_> = STEPS[..10].iter().map(|s| s.checksum()).collect();
    sql(&mut session,r#"INSERT INTO locus_media_comp_video(id,revision,payload) VALUES(X'01992853c12370008000000000000001',7,'{"version":1,"basis":[1,153,40,83,193,35,112,0,128,0,0,0,0,0,0,2],"facts":{"Video":{"container":"mov","stream_index":2,"codec":null,"width":1920,"height":1080,"duration":{"seconds":0.123456789012345,"precision":"Unknown"}}},"last_failure":null}');
INSERT INTO locus_twitter_comp_snapshot(id,revision,payload) VALUES(X'01992853c12370008000000000000003',4,'{"version":1,"basis":null,"snapshot":{"text":"","hashtags":[],"published_at_unix_ms":-9223372036854775808}}');"#).await;
    sql(&mut session,r#"INSERT INTO locus_model_comp_model(id,revision,payload) VALUES(X'01992853c12370008000000000000004',3,'{"version":1,"basis":[1,153,40,83,193,35,112,0,128,0,0,0,0,0,0,2],"facts":{"format":"SafeTensors","tensor_count":0,"element_count":0,"storage_types":{},"tensors":[],"declarations":{}},"last_failure":null}');"#).await;
    crate::runtime::migrate(&mut session).await.unwrap();
    assert_eq!(
        prefix,
        STEPS[..10].iter().map(|s| s.checksum()).collect::<Vec<_>>()
    );
    assert_eq!(count(&mut session,"SELECT count(*) AS count FROM locus_media_comp_video WHERE revision=7 AND duration_seconds='0.123456789012345' AND duration_precision='Unknown' AND json_extract(payload,'$.version')=2 AND json_type(payload,'$.facts') IS NULL").await,1);
    assert_eq!(count(&mut session,"SELECT count(*) AS count FROM locus_twitter_comp_snapshot WHERE q_text='' AND q_hashtags='[]' AND q_published_at='-9223372036854775808'").await,1);
    assert_eq!(count(&mut session,"SELECT count(*) AS count FROM locus_model_comp_model WHERE facts_present='1' AND q_format='SafeTensors' AND q_tensor_count='0' AND q_element_count='0' AND q_storage_types='[]' AND revision=3").await,1);
    for payload in [
        r#"{"version":2,"snapshot":{}}"#,
        r#"{"version":1}"#,
        r#"{"version":1,"snapshot":{"text":12}}"#,
        r#"{"version":1,"snapshot":{"hashtags":""}}"#,
    ] {
        let mut session = Session::memory().await.unwrap();
        execute(&mut session, &STEPS[..10]).await.unwrap();
        sql(&mut session,&format!("INSERT INTO locus_twitter_comp_snapshot(id,revision,payload) VALUES(X'01992853c12370008000000000000003',0,'{payload}')")).await;
        assert!(crate::runtime::migrate(&mut session).await.is_err());
        assert_eq!(
            count(
                &mut session,
                "SELECT count(*) AS count FROM locus_migration_comm_history"
            )
            .await,
            10
        );
        assert_eq!(count(&mut session,"SELECT count(*) AS count FROM pragma_table_info('locus_twitter_comp_snapshot') WHERE name='q_text'").await,0);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn durable_triggers_cover_mutations_and_roll_back_with_savepoints() {
    let mut s = Session::memory().await.unwrap();
    crate::runtime::migrate(&mut s).await.unwrap();
    let entity = "01992853c12370008000000000000001";
    let second = "01992853c12370008000000000000002";
    let file = "01992853c12370008000000000000003";
    let kind = "9fd73d3dd35d41bc8b73402e12f5c017";
    sql(&mut s,&format!("INSERT INTO locus_core_comm_entity VALUES(X'{entity}');INSERT INTO locus_core_comm_entity VALUES(X'{second}');INSERT INTO locus_file_comp_file VALUES(X'{file}','object/test',1);INSERT INTO locus_core_comm_component_registry VALUES(X'{file}',X'{kind}');")).await;
    assert_eq!(
        count(
            &mut s,
            "SELECT count(*) AS count FROM locus_search_comm_invalidation"
        )
        .await,
        2
    );
    sql(&mut s,&format!("INSERT INTO locus_core_rela_membership VALUES(X'{entity}',X'{kind}',X'{file}');UPDATE locus_file_comp_file SET byte_count=2 WHERE id=X'{file}';UPDATE locus_core_rela_membership SET entity=X'{second}' WHERE component=X'{file}';")).await;
    assert_eq!(
        count(
            &mut s,
            "SELECT count(*) AS count FROM locus_search_comm_invalidation"
        )
        .await,
        7
    );
    s.transaction::<_, MigrationError, _>(|c| {
        Box::pin(async move {
            let result = c
                .savepoint::<(), MigrationError, _>(|c| {
                    Box::pin(async move {
                        c.connection()
                            .batch_execute("DELETE FROM locus_core_comm_entity")
                            .await?;
                        Err(MigrationError::Incompatible("rollback".into()))
                    })
                })
                .await;
            assert!(result.is_err());
            Ok(())
        })
    })
    .await
    .unwrap();
    assert_eq!(
        count(
            &mut s,
            "SELECT count(*) AS count FROM locus_search_comm_invalidation"
        )
        .await,
        7
    );
    let result = s
        .transaction::<(), MigrationError, _>(|c| {
            Box::pin(async move {
                c.connection()
                    .batch_execute("DELETE FROM locus_core_comm_entity")
                    .await?;
                Err(MigrationError::Incompatible("rollback".into()))
            })
        })
        .await;
    assert!(result.is_err());
    assert_eq!(
        count(
            &mut s,
            "SELECT count(*) AS count FROM locus_search_comm_invalidation"
        )
        .await,
        7
    );
    sql(
        &mut s,
        &format!("DELETE FROM locus_core_comm_entity WHERE id=X'{second}'"),
    )
    .await;
    assert_eq!(
        count(
            &mut s,
            "SELECT head AS count FROM locus_search_comm_journal_identity"
        )
        .await,
        9
    );
    assert_eq!(
        count(
            &mut s,
            "SELECT count(*) AS count FROM locus_search_comm_invalidation"
        )
        .await,
        9
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn civitai_selected_metadata_migration_retains_invalid_claims_with_projection_error() {
    for value in [
        None,
        Some(serde_json::Value::Null),
        Some(serde_json::json!("")),
        Some(serde_json::json!("SafeTensor")),
        Some(serde_json::json!(5)),
        Some(serde_json::json!(false)),
        Some(serde_json::json!({"x":1})),
        Some(serde_json::json!([])),
    ] {
        let mut session = Session::memory().await.unwrap();
        execute(&mut session, &STEPS[..10]).await.unwrap();
        let mut metadata = serde_json::Map::new();
        if let Some(v) = &value {
            metadata.insert("format".into(), v.clone());
        }
        let payload=serde_json::json!({"version":1,"snapshot":{"matched_version":2,"matched_file":3,"model":{"id":1,"name":"model","type":"Checkpoint","tags":[],"modelVersions":[{"id":2,"name":"version","files":[{"id":3,"name":"file","type":"Model","metadata":metadata}]}]}}}).to_string();
        let retained = payload.clone();
        session.transaction::<_,MigrationError,_>(move|c|Box::pin(async move{sql_query("INSERT INTO locus_civitai_comp_snapshot(id,revision,model,matched_version,matched_file,payload) VALUES(X'01992853c12370008000000000000001',0,'1','2','3',?)").bind::<Text,_>(payload).execute(c.connection()).await?;Ok(())})).await.unwrap();
        crate::runtime::migrate(&mut session).await.unwrap();
        let invalid = value
            .as_ref()
            .is_some_and(|v| !v.is_null() && !v.is_string());
        assert_eq!(count(&mut session,"SELECT count(*) AS count FROM locus_civitai_comp_snapshot WHERE q_projection_error IS NOT NULL").await,i64::from(invalid));
        let observed = session
            .transaction::<_, MigrationError, _>(|c| {
                Box::pin(async move {
                    Ok(
                        sql_query("SELECT payload AS value FROM locus_civitai_comp_snapshot")
                            .get_result::<Value>(c.connection())
                            .await?
                            .value,
                    )
                })
            })
            .await
            .unwrap();
        assert_eq!(observed, retained);
        if !invalid {
            let expected = value
                .as_ref()
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned);
            #[derive(QueryableByName)]
            struct Projection {
                #[diesel(sql_type=diesel::sql_types::Nullable<Text>)]
                value: Option<String>,
            }
            let actual = session
                .transaction::<_, MigrationError, _>(|c| {
                    Box::pin(async move {
                        Ok(sql_query(
                            "SELECT q_file_format AS value FROM locus_civitai_comp_snapshot",
                        )
                        .get_result::<Projection>(c.connection())
                        .await?
                        .value)
                    })
                })
                .await
                .unwrap();
            assert_eq!(actual, expected);
        }
    }
}
#[tokio::test(flavor = "multi_thread")]
async fn incompatible_complete_prefix_is_rejected_without_mutation() {
    for mutation in [
        "UPDATE locus_migration_comm_history SET checksum=printf('%064d',0) WHERE id=1",
        "DELETE FROM locus_migration_comm_history WHERE id=2",
        "UPDATE locus_migration_comm_history SET id=99 WHERE id=10",
        "ALTER TABLE locus_migration_comm_history ADD COLUMN extra TEXT",
        "PRAGMA ignore_check_constraints=ON; UPDATE locus_migration_comm_history SET checksum=x'ff' WHERE id=1; PRAGMA ignore_check_constraints=OFF",
    ] {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("db");
        let mut s = Session::open(&path).await.unwrap();
        crate::runtime::migrate(&mut s).await.unwrap();
        sql(&mut s, mutation).await;
        drop(s);
        let before = std::fs::read(&path).unwrap();
        let mut s = Session::open(&path).await.unwrap();
        assert!(crate::runtime::migrate(&mut s).await.is_err());
        drop(s);
        assert_eq!(before, std::fs::read(&path).unwrap());
    }
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("db");
    let mut s = Session::open(&path).await.unwrap();
    sql(
        &mut s,
        "CREATE TABLE sqliteXlegacy(value TEXT); INSERT INTO sqliteXlegacy VALUES('keep')",
    )
    .await;
    drop(s);
    let before = std::fs::read(&path).unwrap();
    let mut s = Session::open(&path).await.unwrap();
    assert!(
        crate::runtime::migrate(&mut s)
            .await
            .unwrap_err()
            .to_string()
            .contains("pre-system")
    );
    drop(s);
    assert_eq!(before, std::fs::read(&path).unwrap());
}
#[tokio::test(flavor = "multi_thread")]
async fn mixed_rust_sql_and_history_roll_back_one_step_then_resume() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("db");
    let mut s = Session::open(&path).await.unwrap();
    assert!(
        execute(&mut s, FAIL)
            .await
            .unwrap_err()
            .to_string()
            .contains("2 (convert)")
    );
    assert_eq!(
        count(
            &mut s,
            "SELECT count(*) AS count FROM locus_migration_comm_history"
        )
        .await,
        1
    );
    assert_eq!(
        count(
            &mut s,
            "SELECT count(*) AS count FROM fixture WHERE value='{\"old\":7}'"
        )
        .await,
        1
    );
    assert_eq!(
        count(
            &mut s,
            "SELECT count(*) AS count FROM sqlite_schema WHERE name='converted'"
        )
        .await,
        0
    );
    drop(s);
    let mut s = Session::open(&path).await.unwrap();
    execute(&mut s, GOOD).await.unwrap();
    assert_eq!(count(&mut s,"SELECT count(*) AS count FROM fixture WHERE json_extract(value,'$.retained')=7 AND json_extract(value,'$.added')=1").await,1);
    assert_eq!(
        count(
            &mut s,
            "SELECT count(*) AS count FROM locus_migration_comm_history"
        )
        .await,
        2
    );
}
#[tokio::test(flavor = "multi_thread")]
async fn cancellation_discards_connection_and_reopens_durable_prefix() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("db");
    let mut s = Session::open(&path).await.unwrap();
    execute(&mut s, &[SEED]).await.unwrap();
    let mut runner = Box::pin(execute(&mut s, PENDING));
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        tokio::select! {
            result = &mut runner => panic!("pending step completed unexpectedly: {result:?}"),
            _ = PENDING_ENTERED.notified() => {}
        }
    })
    .await
    .expect("second step must finish its mutations before cancellation");
    drop(runner);
    assert!(!s.is_usable());
    drop(s);
    let mut s = Session::open(&path).await.unwrap();
    assert_eq!(
        count(
            &mut s,
            "SELECT count(*) AS count FROM locus_migration_comm_history"
        )
        .await,
        1
    );
    execute(&mut s, GOOD).await.unwrap();
}
#[tokio::test(flavor = "multi_thread")]
async fn actual_commit_failure_preserves_uncertainty_and_stops_sequence() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("db");
    let mut s = Session::open(&path).await.unwrap();
    let error = execute(&mut s, UNCERTAIN).await.unwrap_err();
    assert!(
        matches!(error,MigrationError::Step { source, .. } if matches!(*source,MigrationError::Store(StoreError::CommitOutcomeUnknown(_))))
    );
    assert!(!s.is_usable());
    drop(s);
    let mut s = Session::open(&path).await.unwrap();
    assert_eq!(
        count(
            &mut s,
            "SELECT count(*) AS count FROM locus_migration_comm_history"
        )
        .await,
        1
    );
    execute(&mut s, GOOD).await.unwrap();
}
#[tokio::test(flavor = "multi_thread")]
async fn failed_first_step_leaves_retryable_empty_ledger() {
    let mut s = Session::memory().await.unwrap();
    assert!(execute(&mut s, &[Step { id: 1, ..CONVERT }]).await.is_err());
    assert_eq!(
        count(
            &mut s,
            "SELECT count(*) AS count FROM locus_migration_comm_history"
        )
        .await,
        0
    );
    execute(&mut s, GOOD).await.unwrap();
}
