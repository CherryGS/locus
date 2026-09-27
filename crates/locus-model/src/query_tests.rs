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
sql_query("INSERT INTO locus_model_comp_model(id,revision,payload) VALUES(?,7,?)").bind::<Binary,_>(id.as_bytes().as_slice()).bind::<Text,_>("x".repeat(4*1024*1024)).execute(c.connection()).await?;
crate::query::write(c,id,&serde_json::from_value::<Option<crate::record::Inspection>>(serde_json::json!({"coverage":"test fixture","format":"SafeTensors","tensor_count":u64::MAX,"element_count":u64::MAX,"storage_types":{"F32":{"tensor_count":18446744073709551615u64,"element_count":18446744073709551615u64}},"tensors":[],"declarations":{}})).unwrap()).await.unwrap();
let provider=crate::query::ModelQueryProvider;let projected=provider.project(c,id).await.unwrap();
for p in &projected{p.validate(provider.definitions().iter().find(|f|f.id==p.field).unwrap()).unwrap();assert_eq!(p.component.as_deref(),Some(id.to_string().as_str()));}
assert_eq!(projected.iter().find(|p|p.field=="model_element_count").unwrap().value,ValueState::Values(vec![Value::Uint(u64::MAX.to_string())]));
sql_query("UPDATE locus_model_comp_model SET q_storage_types='' WHERE id=?").bind::<Binary,_>(id.as_bytes().as_slice()).execute(c.connection()).await?;
assert!(provider.project(c,id).await.is_err());Ok(())
})).await.unwrap();
}
