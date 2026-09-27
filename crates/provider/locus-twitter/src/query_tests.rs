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
sql_query("INSERT INTO locus_twitter_comp_snapshot(id,revision,payload) VALUES(?,7,?)").bind::<Binary,_>(id.as_bytes().as_slice()).bind::<Text,_>("x".repeat(4*1024*1024)).execute(c.connection()).await?;
crate::query::write(c,id,&serde_json::from_value::<crate::capture::TwitterSnapshot>(serde_json::json!({"post_id":"123","page_url":"https://x.com/a/status/123","requested_url":"https://x.com/home","text":"中文 hello","author":{"user_id":"7","handle":"a","display_name":"Author"},"hashtags":[],"published_at_unix_ms":i64::MIN,"observed_at_unix_ms":i64::MAX})).unwrap()).await.unwrap();
let provider=crate::query::TwitterQueryProvider;let projected=provider.project(c,id).await.unwrap();
for p in &projected{p.validate(provider.definitions().iter().find(|f|f.id==p.field).unwrap()).unwrap();assert_eq!(p.component.as_deref(),Some(id.to_string().as_str()));}
assert_eq!(projected.iter().find(|p|p.field=="twitter_published_at").unwrap().value,ValueState::Values(vec![Value::Time(i64::MIN.to_string())]));
sql_query("UPDATE locus_twitter_comp_snapshot SET q_hashtags='' WHERE id=?").bind::<Binary,_>(id.as_bytes().as_slice()).execute(c.connection()).await?;
assert!(provider.project(c,id).await.is_err());Ok(())
})).await.unwrap();
}
