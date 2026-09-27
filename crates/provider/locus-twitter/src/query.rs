use diesel::{
    QueryableByName, sql_query,
    sql_types::{Binary, Nullable, Text},
};
use diesel_async::RunQueryDsl;
use locus_core::api::{ComponentId, KindId};
use locus_query::api::*;
use locus_store::api::Context;
pub struct TwitterQueryProvider;
#[derive(QueryableByName)]
struct Row {
    #[diesel(sql_type=Nullable<Text>)]
    q_post_id: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_page_url: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_requested_url: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_text: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_author_id: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_author_handle: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_author_name: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_hashtags: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_published_at: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_observed_at: Option<String>,
}
impl Provider for TwitterQueryProvider {
    fn kind(&self) -> KindId {
        crate::identity::TWITTER_KIND
    }
    fn definitions(&self) -> Vec<FieldDefinition> {
        vec![
            {
                let mut f = FieldDefinition::new(
                    "twitter_post_id",
                    "twitter",
                    FieldType::Identifier,
                    Shape::Scalar,
                );
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "twitter_page_url",
                    "twitter",
                    FieldType::Identifier,
                    Shape::Scalar,
                );
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "twitter_requested_url",
                    "twitter",
                    FieldType::Identifier,
                    Shape::Scalar,
                );
                f.unit = None;
                f
            },
            {
                let mut f =
                    FieldDefinition::new("twitter_text", "twitter", FieldType::Text, Shape::Scalar);
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "twitter_author_id",
                    "twitter",
                    FieldType::Identifier,
                    Shape::Scalar,
                );
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "twitter_author_handle",
                    "twitter",
                    FieldType::Identifier,
                    Shape::Scalar,
                );
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "twitter_author_name",
                    "twitter",
                    FieldType::Text,
                    Shape::Scalar,
                );
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "twitter_hashtags",
                    "twitter",
                    FieldType::Text,
                    Shape::Collection,
                );
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "twitter_published_at",
                    "twitter",
                    FieldType::Time,
                    Shape::Scalar,
                );
                f.unit = Some("unix_ms".into());
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "twitter_observed_at",
                    "twitter",
                    FieldType::Time,
                    Shape::Scalar,
                );
                f.unit = Some("unix_ms".into());
                f
            },
        ]
    }
    fn project<'a>(&'a self, c: &'a mut Context, id: ComponentId) -> ProjectionFuture<'a> {
        Box::pin(async move {
            let row=sql_query("SELECT q_post_id,q_page_url,q_requested_url,q_text,q_author_id,q_author_handle,q_author_name,q_hashtags,q_published_at,q_observed_at FROM locus_twitter_comp_snapshot WHERE id=?").bind::<Binary,_>(id.as_bytes().as_slice()).get_result::<Row>(c.connection()).await.map_err(|e|QueryError::Projection(e.to_string()))?;
            let values = vec![
                FieldValue::scalar("twitter_post_id", id, row.q_post_id.map(Value::Identifier)),
                FieldValue::scalar(
                    "twitter_page_url",
                    id,
                    row.q_page_url.map(Value::Identifier),
                ),
                FieldValue::scalar(
                    "twitter_requested_url",
                    id,
                    row.q_requested_url.map(Value::Identifier),
                ),
                FieldValue::scalar("twitter_text", id, row.q_text.map(Value::Text)),
                FieldValue::scalar(
                    "twitter_author_id",
                    id,
                    row.q_author_id.map(Value::Identifier),
                ),
                FieldValue::scalar(
                    "twitter_author_handle",
                    id,
                    row.q_author_handle.map(Value::Identifier),
                ),
                FieldValue::scalar(
                    "twitter_author_name",
                    id,
                    row.q_author_name.map(Value::Text),
                ),
                FieldValue::collection(
                    "twitter_hashtags",
                    id,
                    row.q_hashtags
                        .map(|v| {
                            serde_json::from_str::<Vec<String>>(&v)
                                .map(|v| v.into_iter().map(Value::Text).collect())
                        })
                        .transpose()
                        .map_err(|e| QueryError::Projection(e.to_string()))?,
                ),
                FieldValue::scalar(
                    "twitter_published_at",
                    id,
                    row.q_published_at.map(Value::Time),
                ),
                FieldValue::scalar(
                    "twitter_observed_at",
                    id,
                    row.q_observed_at.map(Value::Time),
                ),
            ];
            let definitions = self.definitions();
            for value in &values {
                let definition = definitions
                    .iter()
                    .find(|f| f.id == value.field)
                    .ok_or_else(|| QueryError::Projection("undeclared field".into()))?;
                value.validate(definition)?;
            }
            Ok(values)
        })
    }
}
pub(crate) async fn write(
    c: &mut Context,
    id: ComponentId,
    s: &crate::capture::TwitterSnapshot,
) -> Result<(), crate::error::TwitterError> {
    let query=sql_query("UPDATE locus_twitter_comp_snapshot SET q_post_id=?,q_page_url=?,q_requested_url=?,q_text=?,q_author_id=?,q_author_handle=?,q_author_name=?,q_hashtags=?,q_published_at=?,q_observed_at=? WHERE id=?")
.bind::<Nullable<Text>,_>(s.post_id.clone())
.bind::<Nullable<Text>,_>(s.page_url.clone())
.bind::<Nullable<Text>,_>(s.requested_url.clone())
.bind::<Nullable<Text>,_>(s.text.clone())
.bind::<Nullable<Text>,_>(s.author.as_ref().and_then(|v|v.user_id.clone()))
.bind::<Nullable<Text>,_>(s.author.as_ref().and_then(|v|v.handle.clone()))
.bind::<Nullable<Text>,_>(s.author.as_ref().and_then(|v|v.display_name.clone()))
.bind::<Nullable<Text>,_>(s.hashtags.as_ref().map(serde_json::to_string).transpose().map_err(|e|crate::error::TwitterError::Corrupt(e.to_string()))?)
.bind::<Nullable<Text>,_>(s.published_at_unix_ms.map(|v|v.to_string()))
.bind::<Nullable<Text>,_>(s.observed_at_unix_ms.map(|v|v.to_string()))
.bind::<Binary,_>(id.as_bytes().as_slice());
    query.execute(c.connection()).await?;
    Ok(())
}
