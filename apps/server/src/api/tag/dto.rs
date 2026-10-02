use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TagRecord {
    pub id: String,
    pub name: String,
    pub revision: String,
    pub parent: Option<String>,
}
impl From<locus_tag::api::TagRecord> for TagRecord {
    fn from(t: locus_tag::api::TagRecord) -> Self {
        Self {
            id: t.id.to_string(),
            name: t.name,
            revision: t.revision,
            parent: t.parent.map(|id| id.to_string()),
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TagDocument {
    pub tag: TagRecord,
    pub markdown: String,
}
impl From<locus_tag::api::TagDocument> for TagDocument {
    fn from(document: locus_tag::api::TagDocument) -> Self {
        Self {
            tag: document.tag.into(),
            markdown: document.markdown,
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TagSetRecord {
    pub component_id: String,
    pub tags: Vec<TagRecord>,
}
impl From<locus_tag::api::TagSetRecord> for TagSetRecord {
    fn from(s: locus_tag::api::TagSetRecord) -> Self {
        Self {
            component_id: s.id.to_string(),
            tags: s.tags.into_iter().map(Into::into).collect(),
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct EntityTags {
    pub entity_id: String,
    pub tag_set: Option<TagSetRecord>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub enum TagChange {
    Create {
        name: String,
        #[serde(default)]
        parent: Option<String>,
    },
    Rename {
        id: String,
        revision: String,
        name: String,
    },
    Move {
        id: String,
        revision: String,
        parent: Option<String>,
    },
    Delete {
        id: String,
        revision: String,
    },
    Markdown {
        id: String,
        revision: String,
        markdown: String,
    },
    Add {
        entity_id: String,
        tag_id: String,
    },
    Remove {
        entity_id: String,
        tag_id: String,
    },
}
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct WriteTag {
    pub request_id: String,
    pub change: TagChange,
}
