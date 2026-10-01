use diesel::{
    QueryableByName, sql_query,
    sql_types::{Binary, Nullable, Text},
};
use diesel_async::RunQueryDsl;
use locus_core::api::{ComponentId, KindId};
use locus_query::api::*;
use locus_store::api::Context;
pub struct ModelQueryProvider;
#[derive(QueryableByName)]
struct Row {
    #[diesel(sql_type=Text)]
    facts_present: String,
    #[diesel(sql_type=Nullable<Text>)]
    q_format: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_tensor_count: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_element_count: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    q_storage_types: Option<String>,
}
impl Provider for ModelQueryProvider {
    fn kind(&self) -> KindId {
        crate::identity::MODEL_KIND
    }
    fn definitions(&self) -> Vec<FieldDefinition> {
        vec![
            {
                let mut f = FieldDefinition::new(
                    "model_format",
                    "model",
                    FieldType::Identifier,
                    Shape::Scalar,
                );
                f.choices = Some(DeclaredChoices {
                    closed: true,
                    values: vec!["SafeTensors".into()],
                });
                f.assistance = Assistance::Strings;
                f.unit = None;
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "model_tensor_count",
                    "model",
                    FieldType::Uint,
                    Shape::Scalar,
                );
                f.assistance = Assistance::Bounds;
                f.unit = Some("tensors".into());
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "model_element_count",
                    "model",
                    FieldType::Uint,
                    Shape::Scalar,
                );
                f.assistance = Assistance::Bounds;
                f.unit = Some("elements".into());
                f
            },
            {
                let mut f = FieldDefinition::new(
                    "model_storage_types",
                    "model",
                    FieldType::Identifier,
                    Shape::Collection,
                );
                f.assistance = Assistance::Strings;
                f.unit = None;
                f
            },
        ]
    }
    fn project<'a>(&'a self, c: &'a mut Context, id: ComponentId) -> ProjectionFuture<'a> {
        Box::pin(async move {
            let row=sql_query("SELECT facts_present,q_format,q_tensor_count,q_element_count,q_storage_types FROM locus_model_comp_model WHERE id=?").bind::<Binary,_>(id.as_bytes().as_slice()).get_result::<Row>(c.connection()).await.map_err(|e|QueryError::Projection(e.to_string()))?;
            let present = [
                row.q_format.is_some(),
                row.q_tensor_count.is_some(),
                row.q_element_count.is_some(),
                row.q_storage_types.is_some(),
            ];
            if !matches!(row.facts_present.as_str(), "0" | "1")
                || present.iter().any(|v| *v) != (row.facts_present == "1")
                || present.iter().any(|v| *v) && !present.iter().all(|v| *v)
            {
                return Err(QueryError::Projection(
                    "incomplete Model accepted facts".into(),
                ));
            }
            let values = vec![
                FieldValue::scalar("model_format", id, row.q_format.map(Value::Identifier)),
                FieldValue::scalar(
                    "model_tensor_count",
                    id,
                    row.q_tensor_count.map(Value::Uint),
                ),
                FieldValue::scalar(
                    "model_element_count",
                    id,
                    row.q_element_count.map(Value::Uint),
                ),
                FieldValue::collection(
                    "model_storage_types",
                    id,
                    row.q_storage_types
                        .map(|v| {
                            serde_json::from_str::<Vec<String>>(&v)
                                .map(|v| v.into_iter().map(Value::Identifier).collect())
                        })
                        .transpose()
                        .map_err(|e| QueryError::Projection(e.to_string()))?,
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
    s: &Option<crate::record::Inspection>,
) -> Result<(), crate::error::ModelError> {
    let query=sql_query("UPDATE locus_model_comp_model SET facts_present=?,q_format=?,q_tensor_count=?,q_element_count=?,q_storage_types=? WHERE id=?")
.bind::<Text,_>(if s.is_some(){"1"}else{"0"})
.bind::<Nullable<Text>,_>(s.as_ref().map(|v|v.format.clone()))
.bind::<Nullable<Text>,_>(s.as_ref().map(|v|v.tensor_count.to_string()))
.bind::<Nullable<Text>,_>(s.as_ref().map(|v|v.element_count.to_string()))
.bind::<Nullable<Text>,_>(s.as_ref().map(|v|serde_json::to_string(&v.storage_types.keys().collect::<Vec<_>>())).transpose().map_err(|e|crate::error::ModelError::Corrupt(e.to_string()))?)
.bind::<Binary,_>(id.as_bytes().as_slice());
    query.execute(c.connection()).await?;
    Ok(())
}
