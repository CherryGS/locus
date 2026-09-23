use crate::{
    error::{AttemptFailure, ModelError},
    identity::ModelId,
};
use locus_file::api::FileId;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TensorDescriptor {
    pub name: String,
    pub shape: Vec<u64>,
    pub storage_type: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StorageSummary {
    pub tensor_count: u64,
    pub element_count: u64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Inspection {
    pub format: String,
    pub coverage: String,
    pub tensors: Vec<TensorDescriptor>,
    pub tensor_count: u64,
    pub element_count: u64,
    pub storage_types: BTreeMap<String, StorageSummary>,
    pub declarations: Option<BTreeMap<String, String>>,
}
impl Inspection {
    pub(crate) fn summarize(
        tensors: &[TensorDescriptor],
    ) -> Result<(u64, BTreeMap<String, StorageSummary>), ModelError> {
        let mut total = 0u64;
        let mut types = BTreeMap::<String, StorageSummary>::new();
        let mut names = std::collections::BTreeSet::new();
        for t in tensors {
            if !names.insert(&t.name) {
                return Err(ModelError::Corrupt("duplicate tensor name".into()));
            }
            let dtype: safetensors::Dtype =
                serde_json::from_value(serde_json::Value::String(t.storage_type.clone()))
                    .map_err(|e| ModelError::Corrupt(e.to_string()))?;
            let n = t
                .shape
                .iter()
                .try_fold(1u64, |a, b| a.checked_mul(*b))
                .ok_or_else(|| ModelError::Corrupt("element count overflow".into()))?;
            if n.checked_mul(dtype.bitsize() as u64)
                .is_none_or(|bits| bits % 8 != 0)
            {
                return Err(ModelError::Corrupt("invalid tensor bit extent".into()));
            }
            total = total
                .checked_add(n)
                .ok_or_else(|| ModelError::Corrupt("summary overflow".into()))?;
            let s = types.entry(t.storage_type.clone()).or_default();
            s.tensor_count += 1;
            s.element_count = s
                .element_count
                .checked_add(n)
                .ok_or_else(|| ModelError::Corrupt("summary overflow".into()))?;
        }
        Ok((total, types))
    }
}
pub(crate) const COVERAGE: &str = "SafeTensors header descriptors and complete declared data extent; numerical tensor contents are not read or validated. Statistics describe this file only.";
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelRecord {
    pub id: ModelId,
    pub revision: i64,
    pub basis: Option<FileId>,
    pub facts: Option<Inspection>,
    pub last_failure: Option<AttemptFailure>,
}
impl ModelRecord {
    pub(crate) fn validate(&self) -> Result<(), ModelError> {
        if self.revision < 0 || self.basis.is_some() != self.facts.is_some() {
            return Err(ModelError::Corrupt("invalid revision/result basis".into()));
        }
        if let Some(f) = &self.facts {
            let (n, types) = Inspection::summarize(&f.tensors)?;
            if f.format != "SafeTensors"
                || f.coverage != COVERAGE
                || f.tensor_count != f.tensors.len() as u64
                || f.element_count != n
                || f.storage_types != types
            {
                return Err(ModelError::Corrupt("inconsistent inspection result".into()));
            }
        }
        if self
            .last_failure
            .as_ref()
            .is_some_and(|f| f.detail.is_empty() || f.detail.chars().count() > 4096)
        {
            return Err(ModelError::Corrupt("invalid diagnostic".into()));
        }
        Ok(())
    }
}
