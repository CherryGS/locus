use diesel::{
    QueryableByName, sql_query,
    sql_types::{BigInt, Binary},
};
use diesel_async::RunQueryDsl;
use locus_core::api::{ComponentId, KindId};
use locus_query::api::*;
use locus_store::api::Context;
pub struct FileQueryProvider;
#[derive(QueryableByName)]
struct Row {
    #[diesel(sql_type=BigInt)]
    byte_count: i64,
}
impl Provider for FileQueryProvider {
    fn kind(&self) -> KindId {
        crate::identity::FILE_KIND
    }
    fn definitions(&self) -> Vec<FieldDefinition> {
        let mut f = FieldDefinition::new("file_byte_count", "file", FieldType::Uint, Shape::Scalar);
        f.unit = Some("bytes".into());
        f.optional = false;
        vec![f]
    }
    fn project<'a>(&'a self, c: &'a mut Context, id: ComponentId) -> ProjectionFuture<'a> {
        Box::pin(async move {
            let row = sql_query("SELECT byte_count FROM locus_file_comp_file WHERE id=?")
                .bind::<Binary, _>(id.as_bytes().as_slice())
                .get_result::<Row>(c.connection())
                .await
                .map_err(|e| QueryError::Projection(e.to_string()))?;
            let count =
                u64::try_from(row.byte_count).map_err(|e| QueryError::Projection(e.to_string()))?;
            Ok(vec![FieldValue {
                field: "file_byte_count".into(),
                component: Some(id.to_string()),
                value: ValueState::Values(vec![Value::Uint(count.to_string())]),
            }])
        })
    }
}
