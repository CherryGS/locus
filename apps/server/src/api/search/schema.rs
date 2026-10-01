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
    ObservationBody,
    locus_search::api::Observation,
    "SearchObservationData"
);
transport!(
    StringPageRequestBody,
    locus_search::api::StringPageRequest,
    "SearchStringPageRequestData"
);
transport!(
    StringPageBody,
    locus_search::api::StringPage,
    "SearchStringPageData"
);
transport!(
    BoundsRequestBody,
    locus_search::api::BoundsRequest,
    "SearchBoundsRequestData"
);
transport!(BoundsBody, locus_search::api::Bounds, "SearchBoundsData");
transport!(
    SearchQueryBody,
    crate::api::filter::dto::FilterSource,
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
fn rewrite(value: &mut serde_json::Value, root: &str) {
    match value {
        serde_json::Value::Object(map) => {
            // Utoipa's schema adapter does not retain JSON Schema const. A
            // singleton enum preserves generated discriminants without widening.
            if let Some(value) = map.remove("const") {
                map.insert("enum".into(), serde_json::Value::Array(vec![value]));
            }
            if let Some(serde_json::Value::String(reference)) = map.get_mut("$ref") {
                if let Some(name) = reference.strip_prefix("#/$defs/") {
                    *reference = format!("#/components/schemas/Search_{name}");
                } else if reference == "#" {
                    *reference = format!("#/components/schemas/{root}");
                }
            }
            for value in map.values_mut() {
                rewrite(value, root);
            }
        }
        serde_json::Value::Array(values) => {
            for value in values {
                rewrite(value, root);
            }
        }
        _ => (),
    }
}
pub(crate) fn add<T: schemars::JsonSchema>(
    name: &str,
    components: &mut utoipa::openapi::Components,
) -> anyhow::Result<()> {
    let mut value = serde_json::to_value(schemars::schema_for!(T))?;
    rewrite(&mut value, name);
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
    add::<locus_query::api::Source>("SearchRequestData", components)?;
    add::<locus_search::api::Observation>("SearchObservationData", components)?;
    add::<locus_search::api::StringPageRequest>("SearchStringPageRequestData", components)?;
    add::<locus_search::api::StringPage>("SearchStringPageData", components)?;
    add::<locus_search::api::BoundsRequest>("SearchBoundsRequestData", components)?;
    add::<locus_search::api::Bounds>("SearchBoundsData", components)?;
    add::<locus_filter::api::LiteralRequest>("FilterLiteralRequestData", components)?;
    add::<locus_filter::api::Literal>("FilterLiteralData", components)?;
    add::<locus_filter::api::FieldHelpRequest>("FilterFieldHelpRequestData", components)?;
    add::<locus_filter::api::FieldHelp>("FilterFieldHelpData", components)?;
    add::<locus_filter::api::EditingRequest>("FilterEditingRequestData", components)?;
    add::<locus_filter::api::EditingContext>("FilterEditingData", components)?;
    add::<locus_search::api::SearchStatus>("SearchStatusData", components)?;
    add::<locus_query::api::Catalogue>("SearchCatalogueData", components)?;
    add::<Vec<locus_search::api::Evidence>>("SearchEvidenceData", components)?;
    add::<locus_filter::api::ParsedNode>("ParsedStructure", components)?;
    Ok(())
}
