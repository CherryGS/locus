#![allow(clippy::expect_used, clippy::unwrap_used)]
use diesel::{
    sql_query,
    sql_types::{Binary, Text},
};
use diesel_async::RunQueryDsl;
use locus_query::api::*;
#[tokio::test(flavor = "multi_thread")]
async fn common_projection_is_precise_scoped_and_independent_of_large_payload() {
    let mut session = locus_store::api::Session::memory().await.unwrap();
    locus_migration::api::migrate(&mut session).await.unwrap();
    let id = locus_core::api::ComponentId::new();
    session.transaction::<_,locus_store::api::StoreError,_>(move|c|Box::pin(async move{
sql_query("INSERT INTO locus_civitai_comp_snapshot(id,revision,payload,model,matched_version,matched_file) VALUES(?,7,?,'1','2','3')").bind::<Binary,_>(id.as_bytes().as_slice()).bind::<Text,_>("x".repeat(4*1024*1024)).execute(c.connection()).await?;
crate::query::write(c,id,&serde_json::from_value::<crate::snapshot::Snapshot>(serde_json::json!({"blake3":"0".repeat(64),"matched_version":2,"matched_file":3,"model":{"id":1,"name":"Model","type":"Checkpoint","description":"model common","tags":["tag"],"creator":{"username":"creator"},"modelVersions":[{"id":2,"name":"MATCHED","description":null,"baseModel":"SDXL","files":[{"id":3,"name":"SELECTED.safetensors","type":"Model","metadata":{"fp":"fp16","format":"SafeTensor"}},{"id":4,"name":"WRONG-file","type":"Model"}]},{"id":5,"name":"WRONG-version","files":[]}]},"lookup":{"id":2,"name":"LOOKUP-FALLBACK","description":"LOOKUP-DESCRIPTION","files":[{"id":3,"name":"LOOKUP-FILE","type":"Model"}]}})).unwrap()).await.unwrap();
let provider=crate::query::CivitaiQueryProvider;let projected=provider.project(c,id).await.unwrap();
for p in &projected{p.validate(provider.definitions().iter().find(|f|f.id==p.field).unwrap()).unwrap();assert_eq!(p.component.as_deref(),Some(id.to_string().as_str()));}
assert_eq!(projected.iter().find(|p|p.field=="civitai_file_name").unwrap().value,ValueState::Values(vec![Value::Text("SELECTED.safetensors".into())]));
assert_eq!(projected.iter().find(|p|p.field=="civitai_version_description").unwrap().value,ValueState::Missing);assert!(!serde_json::to_string(&projected).unwrap().contains("WRONG"));assert!(!serde_json::to_string(&projected).unwrap().contains("LOOKUP"));
sql_query("UPDATE locus_civitai_comp_snapshot SET q_model_tags='' WHERE id=?").bind::<Binary,_>(id.as_bytes().as_slice()).execute(c.connection()).await?;
assert!(provider.project(c,id).await.is_err());Ok(())
})).await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn selected_metadata_failure_preserves_snapshot_acceptance() {
    use crate::{
        identity::CivitaiId, record::CivitaiRecord, service::CivitaiService, snapshot::Snapshot,
    };
    let mut session = locus_store::api::Session::memory().await.unwrap();
    locus_migration::api::migrate(&mut session).await.unwrap();
    for key in ["format", "fp", "size"] {
        for value in [
            None,
            Some(serde_json::Value::Null),
            Some(serde_json::json!("")),
            Some(serde_json::json!("fp16")),
            Some(serde_json::json!(1)),
            Some(serde_json::json!(true)),
            Some(serde_json::json!({"nested":"value"})),
            Some(serde_json::json!([])),
        ] {
            let id = locus_core::api::ComponentId::new();
            let mut metadata = serde_json::Map::new();
            if let Some(v) = &value {
                metadata.insert(key.into(), v.clone());
            }
            let file = serde_json::json!({"id":3,"name":"selected","type":"Model","hashes":{"BLAKE3":"0".repeat(64)},"metadata":metadata});
            let version = serde_json::json!({"id":2,"modelId":1,"name":"version","files":[file]});
            let snapshot:Snapshot=serde_json::from_value(serde_json::json!({"blake3":"0".repeat(64),"matched_version":2,"matched_file":3,"model":{"id":1,"name":"model","type":"Checkpoint","tags":[],"modelVersions":[version.clone()]},"lookup":version})).unwrap();
            snapshot.validate().unwrap();
            let record = CivitaiRecord {
                id: CivitaiId::from_component(id),
                revision: 0,
                observation: uuid::Uuid::now_v7().to_string(),
                basis: locus_file::api::FileId::from_component(locus_core::api::ComponentId::new()),
                snapshot: snapshot.clone(),
                examples: vec![],
            };
            session
                .transaction::<_, crate::error::CivitaiError, _>(move |c| {
                    Box::pin(async move {
                        crate::persistence::insert(c, &record).await?;
                        assert_eq!(
                            CivitaiService::read_in(c, record.id).await?.snapshot,
                            snapshot
                        );
                        let projected = crate::query::CivitaiQueryProvider.project(c, id).await;
                        let invalid = value
                            .as_ref()
                            .is_some_and(|v| !v.is_null() && !v.is_string());
                        if invalid {
                            let error = projected.unwrap_err().to_string();
                            assert!(error.contains(&id.to_string()));
                            assert!(error.contains(&format!("civitai_file_{key}")));
                        } else {
                            let values = projected.unwrap();
                            let state = &values
                                .iter()
                                .find(|v| v.field == format!("civitai_file_{key}"))
                                .unwrap()
                                .value;
                            let expected = match value.as_ref().and_then(serde_json::Value::as_str)
                            {
                                None => ValueState::Missing,
                                Some("") => ValueState::Empty,
                                Some(v) => ValueState::Values(vec![Value::Identifier(v.into())]),
                            };
                            assert_eq!(state, &expected);
                        }
                        Ok(())
                    })
                })
                .await
                .unwrap();
        }
    }
}
