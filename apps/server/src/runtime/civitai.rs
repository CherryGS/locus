use super::{registry::Shared, submissions::Arguments};
use crate::api::{
    civitai::{dto::*, mapping},
    dto::{Receipt, TaskOutcome},
    error::{ApiError, ErrorCode},
};
use locus_civitai::api::{CivitaiId, Enrichment};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
#[cfg(test)]
#[path = "civitai_store_tests.rs"]
mod tests;
#[derive(Clone)]
pub(super) struct Operation {
    unconfirmed_effects: bool,
    request: String,
    work: Enrichment,
    active: Option<String>,
    problem: Option<String>,
}
#[derive(Default)]
pub(super) struct CivitaiOperationsStore {
    entries: Mutex<BTreeMap<String, Operation>>,
}
impl CivitaiOperationsStore {
    fn lock(&self) -> std::sync::MutexGuard<'_, BTreeMap<String, Operation>> {
        self.entries.lock().unwrap_or_else(|e| e.into_inner())
    }
    pub(super) fn reserve(&self, r: &CivitaiRequest) -> Result<(), ApiError> {
        let mut entries = self.lock();
        if let Some(id) = &r.continuation {
            let entry = entries.get_mut(id).ok_or_else(|| {
                ApiError::invalid("Original Civitai operation is unavailable in this run")
            })?;
            if entry.active.is_some()
                || entry.unconfirmed_effects
                || entry.work.entity().to_string() != r.entity_id
                || entry.work.file().to_string() != r.file_id
                || entry.work.first_only() != r.first_only
                || entry.work.state() == locus_civitai::api::EnrichmentState::Complete
            {
                return Err(ApiError::new(
                    ErrorCode::RequestConflict,
                    "Original operation is active, complete, or its target differs",
                ));
            }
            entry.request = r.request_id.clone();
            entry.active = Some(r.request_id.clone());
            entry.problem = None;
        } else {
            if entries.values().any(|e| {
                e.work.entity().to_string() == r.entity_id
                    && (e.active.is_some()
                        || e.work.state() == locus_civitai::api::EnrichmentState::Uncertain
                        || e.unconfirmed_effects)
            }) {
                return Err(ApiError::new(
                    ErrorCode::RequestConflict,
                    "Original Civitai work is active or unconfirmed; recover its original result before new enrichment",
                ));
            }
            let entity = crate::api::core::mapping::entity(&r.entity_id)?;
            let file = locus_file::api::FileId::from_bytes(
                uuid::Uuid::parse_str(&r.file_id)
                    .map_err(mapping::error)?
                    .as_bytes(),
            )
            .map_err(mapping::error)?;
            entries.insert(
                r.request_id.clone(),
                Operation {
                    unconfirmed_effects: false,
                    request: r.request_id.clone(),
                    work: Enrichment::new(entity, file, r.first_only),
                    active: Some(r.request_id.clone()),
                    problem: None,
                },
            );
        }
        Ok(())
    }
    pub(super) fn release(&self, r: &CivitaiRequest) {
        let mut entries = self.lock();
        if let Some(id) = &r.continuation {
            if let Some(e) = entries.get_mut(id) {
                e.active = None;
            }
        } else {
            entries.remove(&r.request_id);
        }
    }
    pub(super) fn end_unfinished(&self, request: &str) {
        for entry in self.lock().values_mut() {
            if entry.active.as_deref() == Some(request) {
                entry.active = None;
                entry.unconfirmed_effects = true;
                entry.problem=Some("Execution ended without an attributable provider result. Original effects remain unconfirmed; automatic replay is unavailable.".into());
            }
        }
    }
}
impl Shared {
    pub(super) fn check_civitai_import_scope(&self, r: &CivitaiRequest) -> Result<(), ApiError> {
        if r.continuation.is_none()
            && self
                .imports
                .snapshots()
                .iter()
                .flat_map(|b| &b.items)
                .any(|i| {
                    i.current
                        .entity
                        .is_some_and(|e| e.to_string() == r.entity_id)
                        && i.current.civitai.as_ref().is_some_and(|w| {
                            i.active.is_some()
                                || w.state() == locus_civitai::api::EnrichmentState::Uncertain
                        })
                })
        {
            return Err(ApiError::new(
                ErrorCode::RequestConflict,
                "The origin's imported Civitai work is active or unconfirmed; use whole-item import recovery",
            ));
        }
        Ok(())
    }
    pub fn civitai_operations(&self) -> CivitaiOperations {
        let _admission = self.lock();
        CivitaiOperations {
            run_id: self.run_id.clone(),
            operations: self
                .civitai
                .lock()
                .iter()
                .map(|(id, e)| CivitaiOperation {
                    unconfirmed_effects: e.unconfirmed_effects,
                    last_request_id: e.request.clone(),
                    operation_id: id.clone(),
                    active_request_id: e.active.clone(),
                    outcome: mapping::outcome(&e.work),
                    observation_problem: e.problem.clone(),
                })
                .collect(),
        }
    }
    pub async fn civitai_view(self: &Arc<Self>, id: CivitaiId) -> Result<CivitaiView, ApiError> {
        let d = self.business()?.clone();
        self.query("Read Civitai component", move |task| async move {
            let mut s = d.database.session(&task).await.map_err(mapping::error)?;
            mapping::view(
                d.civitai
                    .view(&d.kernel, &mut s, id)
                    .await
                    .map_err(mapping::domain)?,
            )
        })
        .await
    }
    pub async fn civitai_page(self: &Arc<Self>, id: CivitaiId) -> Result<CivitaiPage, ApiError> {
        let d = self.business()?.clone();
        self.query("Read origin-owned Civitai Page", move |task| async move {
            let mut s = d.database.session(&task).await.map_err(mapping::error)?;
            mapping::page(
                d.civitai
                    .page(&d.kernel, &mut s, id)
                    .await
                    .map_err(mapping::domain)?,
            )
        })
        .await
    }
    pub async fn civitai_version(
        self: &Arc<Self>,
        id: CivitaiId,
        version: u64,
        source: Option<CivitaiId>,
    ) -> Result<CivitaiVersionView, ApiError> {
        let d = self.business()?.clone();
        self.query("Read whole Civitai version unit", move |task| async move {
            let mut s = d.database.session(&task).await.map_err(mapping::error)?;
            mapping::version_view(
                d.civitai
                    .version(&d.kernel, &mut s, id, version, source)
                    .await
                    .map_err(mapping::domain)?,
            )
        })
        .await
    }
    pub fn enrich_civitai(self: &Arc<Self>, r: CivitaiRequest) -> Result<Receipt, ApiError> {
        let d = self.business()?.clone();
        let state = self.clone();
        let operation_id = r
            .continuation
            .clone()
            .unwrap_or_else(|| r.request_id.clone());
        self.public(
            r.request_id.clone(),
            Arguments::Civitai(r),
            "Enrich origin weight from Civitai",
            move |task| async move {
                let original = state.civitai.lock().get(&operation_id).cloned();
                if let Some(mut entry) = original {
                    match d.database.session(&task).await {
                        Ok(mut s) => {
                            d.civitai
                                .enrich(
                                    &d.kernel,
                                    &d.files,
                                    &d.media,
                                    &mut s,
                                    &mut entry.work,
                                    &|work| {
                                        if let Some(entry) =
                                            state.civitai.lock().get_mut(&operation_id)
                                        {
                                            entry.work = work.clone();
                                        }
                                    },
                                )
                                .await
                        }
                        Err(e) => entry.problem = Some(e.to_string()),
                    }
                    entry.active = None;
                    state.civitai.lock().insert(operation_id.clone(), entry);
                }
                let completed = state.civitai.lock().get(&operation_id).cloned();
                TaskOutcome::Civitai {
                    operation_id,
                    result: completed
                        .as_ref()
                        .map(|e| Box::new(mapping::outcome(&e.work))),
                    observation_problem: completed.and_then(|e| e.problem),
                }
            },
        )
    }
}
