use diesel::{
    QueryableByName, sql_query,
    sql_types::{Binary, Nullable, Text},
};
use diesel_async::RunQueryDsl;
use locus_core::api::{ComponentId, KindId};
use locus_query::api::*;
use locus_store::api::Context;
pub struct CivitaiQueryProvider;
#[derive(QueryableByName)]
struct Row {
    #[diesel(sql_type=Nullable<Text>)]
    q_projection_error: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_model_id: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_model_name: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_model_type: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_model_description: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_model_tags: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_creator: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_version_id: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_version_name: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_version_description: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_base_model: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_file_id: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_file_name: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_file_type: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_file_format: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_file_fp: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_file_size: Option<String>,
}
impl Provider for CivitaiQueryProvider {
    fn kind(&self) -> KindId {
        crate::identity::CIVITAI_KIND
    }
    fn definitions(&self) -> Vec<FieldDefinition> {
        let mut definitions = vec![
            {
                let mut f = FieldDefinition::new(
                    "civitai_model_id",
                    "civitai",
                    FieldType::Identifier,
                    Shape::Scalar,
                );
                f.unit = None;
                f.optional = false;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "civitai_model_name",
                    "civitai",
                    FieldType::Text,
                    Shape::Scalar,
                );
                f.assistance = Assistance::Strings;
                f.unit = None;
                f.optional = false;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "civitai_model_type",
                    "civitai",
                    FieldType::Identifier,
                    Shape::Scalar,
                );
                f.assistance = Assistance::Strings;
                f.unit = None;
                f.optional = false;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "civitai_model_description",
                    "civitai",
                    FieldType::Text,
                    Shape::Scalar,
                );
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "civitai_model_tags",
                    "civitai",
                    FieldType::Text,
                    Shape::Collection,
                );
                f.assistance = Assistance::Strings;
                f.unit = None;
                f.optional = false;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "civitai_creator",
                    "civitai",
                    FieldType::Text,
                    Shape::Scalar,
                );
                f.assistance = Assistance::Strings;
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "civitai_version_id",
                    "civitai",
                    FieldType::Identifier,
                    Shape::Scalar,
                );
                f.unit = None;
                f.optional = false;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "civitai_version_name",
                    "civitai",
                    FieldType::Text,
                    Shape::Scalar,
                );
                f.assistance = Assistance::Strings;
                f.unit = None;
                f.optional = false;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "civitai_version_description",
                    "civitai",
                    FieldType::Text,
                    Shape::Scalar,
                );
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "civitai_base_model",
                    "civitai",
                    FieldType::Identifier,
                    Shape::Scalar,
                );
                f.assistance = Assistance::Strings;
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "civitai_file_id",
                    "civitai",
                    FieldType::Identifier,
                    Shape::Scalar,
                );
                f.unit = None;
                f.optional = false;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "civitai_file_name",
                    "civitai",
                    FieldType::Text,
                    Shape::Scalar,
                );
                f.assistance = Assistance::Strings;
                f.unit = None;
                f.optional = false;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "civitai_file_type",
                    "civitai",
                    FieldType::Identifier,
                    Shape::Scalar,
                );
                f.assistance = Assistance::Strings;
                f.unit = None;
                f.optional = false;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "civitai_file_format",
                    "civitai",
                    FieldType::Identifier,
                    Shape::Scalar,
                );
                f.assistance = Assistance::Strings;
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "civitai_file_fp",
                    "civitai",
                    FieldType::Identifier,
                    Shape::Scalar,
                );
                f.assistance = Assistance::Strings;
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "civitai_file_size",
                    "civitai",
                    FieldType::Identifier,
                    Shape::Scalar,
                );
                f.assistance = Assistance::Strings;
                f.unit = None;
                f
            },
        ];
        for field in &mut definitions {
            field.extraction_version = 2;
        }
        definitions
    }
    fn project<'a>(&'a self, c: &'a mut Context, id: ComponentId) -> ProjectionFuture<'a> {
        Box::pin(async move {
            let row=sql_query("SELECT q_projection_error,q_model_id,q_model_name,q_model_type,q_model_description,q_model_tags,q_creator,q_version_id,q_version_name,q_version_description,q_base_model,q_file_id,q_file_name,q_file_type,q_file_format,q_file_fp,q_file_size FROM locus_civitai_comp_snapshot WHERE id=?").bind::<Binary,_>(id.as_bytes().as_slice()).get_result::<Row>(c.connection()).await.map_err(|e|QueryError::Projection(e.to_string()))?;
            if let Some(error) = row.q_projection_error {
                return Err(QueryError::Projection(format!(
                    "Civitai component {id}: {error}"
                )));
            }
            let values = vec![
                FieldValue::scalar(
                    "civitai_model_id",
                    id,
                    row.q_model_id.map(Value::Identifier),
                ),
                FieldValue::scalar("civitai_model_name", id, row.q_model_name.map(Value::Text)),
                FieldValue::scalar(
                    "civitai_model_type",
                    id,
                    row.q_model_type.map(Value::Identifier),
                ),
                FieldValue::scalar(
                    "civitai_model_description",
                    id,
                    row.q_model_description.map(Value::Text),
                ),
                FieldValue::collection(
                    "civitai_model_tags",
                    id,
                    row.q_model_tags
                        .map(|v| {
                            serde_json::from_str::<Vec<String>>(&v)
                                .map(|v| v.into_iter().map(Value::Text).collect())
                        })
                        .transpose()
                        .map_err(|e| QueryError::Projection(e.to_string()))?,
                ),
                FieldValue::scalar("civitai_creator", id, row.q_creator.map(Value::Text)),
                FieldValue::scalar(
                    "civitai_version_id",
                    id,
                    row.q_version_id.map(Value::Identifier),
                ),
                FieldValue::scalar(
                    "civitai_version_name",
                    id,
                    row.q_version_name.map(Value::Text),
                ),
                FieldValue::scalar(
                    "civitai_version_description",
                    id,
                    row.q_version_description.map(Value::Text),
                ),
                FieldValue::scalar(
                    "civitai_base_model",
                    id,
                    row.q_base_model.map(Value::Identifier),
                ),
                FieldValue::scalar("civitai_file_id", id, row.q_file_id.map(Value::Identifier)),
                FieldValue::scalar("civitai_file_name", id, row.q_file_name.map(Value::Text)),
                FieldValue::scalar(
                    "civitai_file_type",
                    id,
                    row.q_file_type.map(Value::Identifier),
                ),
                FieldValue::scalar(
                    "civitai_file_format",
                    id,
                    row.q_file_format.map(Value::Identifier),
                ),
                FieldValue::scalar("civitai_file_fp", id, row.q_file_fp.map(Value::Identifier)),
                FieldValue::scalar(
                    "civitai_file_size",
                    id,
                    row.q_file_size.map(Value::Identifier),
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
    s: &crate::snapshot::Snapshot,
) -> Result<(), crate::error::CivitaiError> {
    let version = s.matched()?;
    let file = version
        .files
        .iter()
        .find(|f| f.id == s.matched_file)
        .ok_or_else(|| crate::error::CivitaiError::Invalid("missing matched origin file".into()))?;
    // Arbitrary metadata remains accepted and retained. A present unsupported
    // selected value is a derived projection failure, never a fabricated absence.
    let projection_error = ["format", "fp", "size"].into_iter().find_map(|key| {
        file.metadata
            .get(key)
            .filter(|v| !v.is_null() && !v.is_string())
            .map(|_| format!("civitai_file_{key}: expected a string or null"))
    });
    let query=sql_query("UPDATE locus_civitai_comp_snapshot SET q_projection_error=?,q_model_id=?,q_model_name=?,q_model_type=?,q_model_description=?,q_model_tags=?,q_creator=?,q_version_id=?,q_version_name=?,q_version_description=?,q_base_model=?,q_file_id=?,q_file_name=?,q_file_type=?,q_file_format=?,q_file_fp=?,q_file_size=? WHERE id=?")
.bind::<Nullable<Text>,_>(projection_error)
.bind::<Nullable<Text>,_>(Some(s.model.id.to_string()))
.bind::<Nullable<Text>,_>(Some(s.model.name.clone()))
.bind::<Nullable<Text>,_>(Some(s.model.kind.clone()))
.bind::<Nullable<Text>,_>(s.model.description.clone())
.bind::<Nullable<Text>,_>(Some(serde_json::to_string(&s.model.tags).map_err(|e|crate::error::CivitaiError::Invalid(e.to_string()))?))
.bind::<Nullable<Text>,_>(s.model.creator.as_ref().map(|v|v.username.clone()))
.bind::<Nullable<Text>,_>(Some(version.id.to_string()))
.bind::<Nullable<Text>,_>(Some(version.name.clone()))
.bind::<Nullable<Text>,_>(version.description.clone())
.bind::<Nullable<Text>,_>(version.base_model.clone())
.bind::<Nullable<Text>,_>(Some(file.id.to_string()))
.bind::<Nullable<Text>,_>(Some(file.name.clone()))
.bind::<Nullable<Text>,_>(Some(file.kind.clone()))
.bind::<Nullable<Text>,_>(file.metadata.get("format").and_then(serde_json::Value::as_str).map(str::to_owned))
.bind::<Nullable<Text>,_>(file.metadata.get("fp").and_then(serde_json::Value::as_str).map(str::to_owned))
.bind::<Nullable<Text>,_>(file.metadata.get("size").and_then(serde_json::Value::as_str).map(str::to_owned))
.bind::<Binary,_>(id.as_bytes().as_slice());
    query.execute(c.connection()).await?;
    Ok(())
}
