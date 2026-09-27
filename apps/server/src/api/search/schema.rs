use serde::{Deserialize, Serialize};
use utoipa::{
    PartialSchema, ToSchema,
    openapi::{Ref, RefOr, schema::Schema},
};
macro_rules! transport {
    ($name:ident,$type:ty,$schema:literal) => {
        #[derive(Serialize, Deserialize)]
        #[serde(transparent)]
        pub(super) struct $name(pub $type);
        impl PartialSchema for $name {
            fn schema() -> RefOr<Schema> {
                Ref::from_schema_name($schema).into()
            }
        }
        impl ToSchema for $name {}
    };
}
transport!(
    SearchQueryBody,
    locus_search::api::SearchRequest,
    "SearchRequestData"
);
transport!(
    SearchStatusBody,
    locus_search::api::SearchStatus,
    "SearchStatusData"
);
transport!(
    SearchEvidenceBody,
    Vec<locus_search::api::Evidence>,
    "SearchEvidenceData"
);
#[derive(Serialize)]
#[serde(transparent)]
pub(super) struct SearchCatalogueBody(pub locus_query::api::Catalogue);
impl PartialSchema for SearchCatalogueBody {
    fn schema() -> RefOr<Schema> {
        Ref::from_schema_name("SearchCatalogueData").into()
    }
}
impl ToSchema for SearchCatalogueBody {}
#[derive(Deserialize, ToSchema)]
pub(super) struct ReadEvidence {
    pub context: String,
    pub entities: Vec<String>,
}
#[derive(Deserialize, ToSchema)]
pub(super) struct ReleaseContext {
    pub context: String,
}
fn rewrite(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(serde_json::Value::String(reference)) = map.get_mut("$ref")
                && let Some(name) = reference.strip_prefix("#/$defs/")
            {
                *reference = format!("#/components/schemas/Search_{name}");
            }
            for value in map.values_mut() {
                rewrite(value);
            }
        }
        serde_json::Value::Array(values) => {
            for value in values {
                rewrite(value);
            }
        }
        _ => (),
    }
}
fn add<T: schemars::JsonSchema>(
    name: &str,
    components: &mut utoipa::openapi::Components,
) -> anyhow::Result<()> {
    let mut value = serde_json::to_value(schemars::schema_for!(T))?;
    rewrite(&mut value);
    if let Some(serde_json::Value::Object(definitions)) =
        value.as_object_mut().and_then(|v| v.remove("$defs"))
    {
        for (key, value) in definitions {
            components
                .schemas
                .insert(format!("Search_{key}"), serde_json::from_value(value)?);
        }
    }
    components
        .schemas
        .insert(name.into(), serde_json::from_value(value)?);
    Ok(())
}
pub(crate) fn register(document: &mut utoipa::openapi::OpenApi) -> anyhow::Result<()> {
    let components = document.components.get_or_insert_with(Default::default);
    add::<locus_search::api::SearchRequest>("SearchRequestData", components)?;
    add::<locus_search::api::SearchStatus>("SearchStatusData", components)?;
    add::<locus_query::api::Catalogue>("SearchCatalogueData", components)?;
    add::<Vec<locus_search::api::Evidence>>("SearchEvidenceData", components)?;
    Ok(())
}
