use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Both independently acquired observations are retained, including optional extras.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Snapshot {
    pub model: Model,
    pub lookup: ModelVersion,
    pub matched_version: u64,
    pub matched_file: u64,
    pub blake3: String,
}
impl Snapshot {
    pub fn validate(&self) -> Result<(), crate::error::CivitaiError> {
        use crate::error::CivitaiError;
        let invalid =
            || CivitaiError::Invalid("inconsistent model/version/concrete-file evidence".into());
        if self.blake3.len() != 64
            || !self.blake3.bytes().all(|b| b.is_ascii_hexdigit())
            || self.lookup.model_id != Some(self.model.id)
            || self.lookup.id != self.matched_version
        {
            return Err(invalid());
        }
        let versions: Vec<_> = self
            .model
            .model_versions
            .iter()
            .filter(|v| v.id == self.matched_version)
            .collect();
        if versions.len() != 1 {
            return Err(invalid());
        }
        let version = versions[0];
        if version.model_id.is_some_and(|id| id != self.model.id) {
            return Err(invalid());
        }
        let matches: Vec<_> = self
            .lookup
            .files
            .iter()
            .filter(|f| {
                f.hashes.iter().any(|(k, v)| {
                    k.eq_ignore_ascii_case("BLAKE3") && v.eq_ignore_ascii_case(&self.blake3)
                })
            })
            .collect();
        if matches.len() != 1
            || matches[0].id != self.matched_file
            || self
                .lookup
                .files
                .iter()
                .filter(|f| f.id == self.matched_file)
                .count()
                != 1
        {
            return Err(invalid());
        }
        let parent: Vec<_> = version
            .files
            .iter()
            .filter(|f| f.id == self.matched_file)
            .collect();
        if parent.len() != 1
            || parent[0].hashes.iter().any(|(k, v)| {
                k.eq_ignore_ascii_case("BLAKE3") && !v.eq_ignore_ascii_case(&self.blake3)
            })
        {
            return Err(invalid());
        }
        let mut versions = std::collections::HashSet::new();
        for v in &self.model.model_versions {
            if !versions.insert(v.id) || v.model_id.is_some_and(|id| id != self.model.id) {
                return Err(invalid());
            }
            let mut files = std::collections::HashSet::new();
            if v.files.iter().any(|f| !files.insert(f.id)) {
                return Err(invalid());
            }
        }
        Ok(())
    }
    pub fn matched(&self) -> Result<&ModelVersion, crate::error::CivitaiError> {
        self.model
            .model_versions
            .iter()
            .find(|v| v.id == self.matched_version)
            .ok_or_else(|| crate::error::CivitaiError::Invalid("matched version missing".into()))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: u64,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub nsfw: Option<bool>,
    #[serde(default)]
    pub nsfw_level: Option<u32>,
    #[serde(default)]
    pub availability: Option<String>,
    #[serde(default)]
    pub supports_generation: Option<bool>,
    #[serde(default)]
    pub stats: Option<Stats>,
    #[serde(default)]
    pub creator: Option<Creator>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub model_versions: Vec<ModelVersion>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Creator {
    pub username: String,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    #[serde(default)]
    pub download_count: Option<u64>,
    #[serde(default)]
    pub thumbs_up_count: Option<u64>,
    #[serde(default)]
    pub thumbs_down_count: Option<u64>,
    #[serde(default)]
    pub comment_count: Option<u64>,
    #[serde(default)]
    pub tipped_amount_count: Option<u64>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelVersion {
    pub id: u64,
    #[serde(default)]
    pub model_id: Option<u64>,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub base_model: Option<String>,
    #[serde(default)]
    pub base_model_type: Option<String>,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub availability: Option<String>,
    #[serde(default)]
    pub supports_generation: Option<bool>,
    #[serde(default)]
    pub stats: Option<Stats>,
    #[serde(default)]
    pub files: Vec<ModelFile>,
    #[serde(default)]
    pub images: Vec<PreviewImage>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFile {
    pub id: u64,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub size_kb: Option<f64>,
    #[serde(default)]
    pub download_url: Option<String>,
    #[serde(default)]
    pub primary: Option<bool>,
    #[serde(default)]
    pub hashes: BTreeMap<String, String>,
    #[serde(default)]
    pub metadata: BTreeMap<String, Value>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewImage {
    #[serde(default)]
    pub id: Option<u64>,
    pub url: String,
    #[serde(default)]
    pub nsfw_level: Option<u32>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    #[serde(default)]
    pub hash: Option<String>,
    #[serde(rename = "type", default)]
    pub kind: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}
