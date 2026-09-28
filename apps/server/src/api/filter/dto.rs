use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct FilterSource {
    pub format: String,
    pub version: u32,
    pub text: String,
}
impl From<FilterSource> for locus_query::api::Source {
    fn from(s: FilterSource) -> Self {
        Self {
            format: s.format,
            version: s.version,
            text: s.text,
        }
    }
}
impl From<locus_query::api::Source> for FilterSource {
    fn from(s: locus_query::api::Source) -> Self {
        Self {
            format: s.format,
            version: s.version,
            text: s.text,
        }
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct FilterPreset {
    pub id: String,
    pub name: String,
    pub revision: String,
    pub source: FilterSource,
}
impl From<locus_filter::api::Preset> for FilterPreset {
    fn from(p: locus_filter::api::Preset) -> Self {
        Self {
            id: p.id,
            name: p.name,
            revision: p.revision,
            source: p.source.into(),
        }
    }
}
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct FilterPresetSummary {
    pub id: String,
    pub name: String,
    pub revision: String,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub enum FilterChange {
    Create {
        name: String,
        source: FilterSource,
    },
    Update {
        id: String,
        revision: String,
        name: String,
        source: FilterSource,
    },
    Rename {
        id: String,
        revision: String,
        name: String,
    },
    Copy {
        id: String,
        name: String,
    },
    Delete {
        id: String,
        revision: String,
    },
}
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct WriteFilterPreset {
    pub request_id: String,
    pub change: FilterChange,
}
#[derive(Serialize, ToSchema)]
pub struct FilterDiagnostic {
    pub start: usize,
    pub end: usize,
    pub message: String,
}
#[derive(Serialize, ToSchema)]
pub struct FilterAnalysis {
    pub source: FilterSource,
    pub state: String,
    pub diagnostics: Vec<FilterDiagnostic>,
    #[schema(value_type = Option<ParsedStructure>)]
    pub parsed: Option<locus_filter::api::ParsedNode>,
}
#[derive(Serialize, ToSchema)]
pub struct FilterLanguage {
    pub format: String,
    pub version: u32,
    pub offset_encoding: String,
    pub syntax: Vec<String>,
}
#[derive(Serialize)]
pub struct ParsedStructure;
impl utoipa::PartialSchema for ParsedStructure {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        utoipa::openapi::Ref::from_schema_name("ParsedStructure").into()
    }
}
impl utoipa::ToSchema for ParsedStructure {}
