use diesel::{
    QueryableByName, sql_query,
    sql_types::{Binary, Nullable, Text},
};
use diesel_async::RunQueryDsl;
use locus_core::api::{ComponentId, KindId};
use locus_query::api::*;
use locus_store::api::Context;
pub struct BilibiliQueryProvider;
#[derive(QueryableByName)]
struct Row {
    #[diesel(sql_type=Nullable<Text>)]
    q_bvid: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_aid: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_page_url: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_title: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_description: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_author_id: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_author_name: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_tags: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_published_at: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_observed_at: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_part_cid: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_part_number: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_part_title: Option<String>,
}
impl Provider for BilibiliQueryProvider {
    fn kind(&self) -> KindId {
        crate::identity::BILIBILI_KIND
    }
    fn definitions(&self) -> Vec<FieldDefinition> {
        vec![
            {
                let mut f = FieldDefinition::new(
                    "bilibili_bvid",
                    "bilibili",
                    FieldType::Identifier,
                    Shape::Scalar,
                );
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "bilibili_aid",
                    "bilibili",
                    FieldType::Identifier,
                    Shape::Scalar,
                );
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "bilibili_page_url",
                    "bilibili",
                    FieldType::Identifier,
                    Shape::Scalar,
                );
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "bilibili_title",
                    "bilibili",
                    FieldType::Text,
                    Shape::Scalar,
                );
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "bilibili_description",
                    "bilibili",
                    FieldType::Text,
                    Shape::Scalar,
                );
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "bilibili_author_id",
                    "bilibili",
                    FieldType::Identifier,
                    Shape::Scalar,
                );
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "bilibili_author_name",
                    "bilibili",
                    FieldType::Text,
                    Shape::Scalar,
                );
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "bilibili_tags",
                    "bilibili",
                    FieldType::Text,
                    Shape::Collection,
                );
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "bilibili_published_at",
                    "bilibili",
                    FieldType::Time,
                    Shape::Scalar,
                );
                f.unit = Some("unix_ms".into());
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "bilibili_observed_at",
                    "bilibili",
                    FieldType::Time,
                    Shape::Scalar,
                );
                f.unit = Some("unix_ms".into());
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "bilibili_part_cid",
                    "bilibili",
                    FieldType::Identifier,
                    Shape::Scalar,
                );
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "bilibili_part_number",
                    "bilibili",
                    FieldType::Uint,
                    Shape::Scalar,
                );
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "bilibili_part_title",
                    "bilibili",
                    FieldType::Text,
                    Shape::Scalar,
                );
                f.unit = None;
                f
            },
        ]
    }
    fn project<'a>(&'a self, c: &'a mut Context, id: ComponentId) -> ProjectionFuture<'a> {
        Box::pin(async move {
            let row=sql_query("SELECT q_bvid,q_aid,q_page_url,q_title,q_description,q_author_id,q_author_name,q_tags,q_published_at,q_observed_at,q_part_cid,q_part_number,q_part_title FROM locus_bilibili_comp_snapshot WHERE id=?").bind::<Binary,_>(id.as_bytes().as_slice()).get_result::<Row>(c.connection()).await.map_err(|e|QueryError::Projection(e.to_string()))?;
            let values = vec![
                FieldValue::scalar("bilibili_bvid", id, row.q_bvid.map(Value::Identifier)),
                FieldValue::scalar("bilibili_aid", id, row.q_aid.map(Value::Identifier)),
                FieldValue::scalar(
                    "bilibili_page_url",
                    id,
                    row.q_page_url.map(Value::Identifier),
                ),
                FieldValue::scalar("bilibili_title", id, row.q_title.map(Value::Text)),
                FieldValue::scalar(
                    "bilibili_description",
                    id,
                    row.q_description.map(Value::Text),
                ),
                FieldValue::scalar(
                    "bilibili_author_id",
                    id,
                    row.q_author_id.map(Value::Identifier),
                ),
                FieldValue::scalar(
                    "bilibili_author_name",
                    id,
                    row.q_author_name.map(Value::Text),
                ),
                FieldValue::collection(
                    "bilibili_tags",
                    id,
                    row.q_tags
                        .map(|v| {
                            serde_json::from_str::<Vec<String>>(&v)
                                .map(|v| v.into_iter().map(Value::Text).collect())
                        })
                        .transpose()
                        .map_err(|e| QueryError::Projection(e.to_string()))?,
                ),
                FieldValue::scalar(
                    "bilibili_published_at",
                    id,
                    row.q_published_at.map(Value::Time),
                ),
                FieldValue::scalar(
                    "bilibili_observed_at",
                    id,
                    row.q_observed_at.map(Value::Time),
                ),
                FieldValue::scalar(
                    "bilibili_part_cid",
                    id,
                    row.q_part_cid.map(Value::Identifier),
                ),
                FieldValue::scalar(
                    "bilibili_part_number",
                    id,
                    row.q_part_number.map(Value::Uint),
                ),
                FieldValue::scalar("bilibili_part_title", id, row.q_part_title.map(Value::Text)),
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
    s: &crate::capture::BilibiliSnapshot,
) -> Result<(), crate::error::BilibiliError> {
    let query=sql_query("UPDATE locus_bilibili_comp_snapshot SET q_bvid=?,q_aid=?,q_page_url=?,q_title=?,q_description=?,q_author_id=?,q_author_name=?,q_tags=?,q_published_at=?,q_observed_at=?,q_part_cid=?,q_part_number=?,q_part_title=? WHERE id=?")
.bind::<Nullable<Text>,_>(s.bvid.clone())
.bind::<Nullable<Text>,_>(s.aid.clone())
.bind::<Nullable<Text>,_>(s.page_url.clone())
.bind::<Nullable<Text>,_>(s.title.clone())
.bind::<Nullable<Text>,_>(s.description.clone())
.bind::<Nullable<Text>,_>(s.author.as_ref().and_then(|v|v.user_id.clone()))
.bind::<Nullable<Text>,_>(s.author.as_ref().and_then(|v|v.display_name.clone()))
.bind::<Nullable<Text>,_>(s.tags.as_ref().map(serde_json::to_string).transpose().map_err(|e|crate::error::BilibiliError::Corrupt(e.to_string()))?)
.bind::<Nullable<Text>,_>(s.published_at_unix_ms.map(|v|v.to_string()))
.bind::<Nullable<Text>,_>(s.observed_at_unix_ms.map(|v|v.to_string()))
.bind::<Nullable<Text>,_>(s.part.as_ref().and_then(|v|v.cid.clone()))
.bind::<Nullable<Text>,_>(s.part.as_ref().and_then(|v|v.number.map(|v|v.to_string())))
.bind::<Nullable<Text>,_>(s.part.as_ref().and_then(|v|v.title.clone()))
.bind::<Binary,_>(id.as_bytes().as_slice());
    query.execute(c.connection()).await?;
    Ok(())
}
