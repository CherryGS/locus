use super::{Shared, submissions::Arguments};
use crate::api::{
    dto::MutationOutcome,
    error::{ApiError, ErrorCode},
    filter::dto::*,
};
use locus_filter::api::{FilterError, FilterService};
use std::sync::Arc;
pub(crate) fn failure(error: FilterError) -> ApiError {
    let code = match error {
        FilterError::Absent => ErrorCode::NotFound,
        FilterError::Conflict | FilterError::DuplicateName => ErrorCode::RequestConflict,
        FilterError::BlankName | FilterError::Envelope => ErrorCode::InvalidRequest,
        _ => ErrorCode::OperationFailed,
    };
    ApiError::new(code, error.to_string())
}
impl Shared {
    pub async fn filter_presets(self: &Arc<Self>) -> Result<Vec<FilterPresetSummary>, ApiError> {
        let database = self.business()?.database.clone();
        self.query("List Filter presets", move |task| async move {
            let mut s = database
                .session(&task)
                .await
                .map_err(|e| failure(e.into()))?;
            FilterService
                .list(&mut s)
                .await
                .map(|ps| {
                    ps.into_iter()
                        .map(|p| FilterPresetSummary {
                            id: p.id,
                            name: p.name,
                            revision: p.revision,
                        })
                        .collect()
                })
                .map_err(failure)
        })
        .await
    }
    pub async fn filter_preset(self: &Arc<Self>, id: String) -> Result<FilterPreset, ApiError> {
        let database = self.business()?.database.clone();
        self.query("Read Filter preset", move |task| async move {
            let mut s = database
                .session(&task)
                .await
                .map_err(|e| failure(e.into()))?;
            s.transaction(move |c| Box::pin(async move { FilterService::read_in(c, &id).await }))
                .await
                .map(Into::into)
                .map_err(failure)
        })
        .await
    }
    pub async fn filter_write(
        self: &Arc<Self>,
        request: String,
        change: FilterChange,
    ) -> Result<MutationOutcome, ApiError> {
        let database = self.business()?.database.clone();
        self.mutation(
            request,
            Arguments::Filter(change.clone()),
            "Save Filter preset",
            move |task| async move {
                let result = async {
                    let mut s = database.session(&task).await?;
                    s.transaction(move |c| {
                        Box::pin(async move {
                            let saved = match change {
                                FilterChange::Create { name, source } => {
                                    FilterService::create_in(c, &name, source.into()).await?
                                }
                                FilterChange::Update {
                                    id,
                                    revision,
                                    name,
                                    source,
                                } => {
                                    FilterService::update_in(
                                        c,
                                        &id,
                                        &revision,
                                        &name,
                                        source.into(),
                                    )
                                    .await?
                                }
                                FilterChange::Rename { id, revision, name } => {
                                    FilterService::rename_in(c, &id, &revision, &name).await?
                                }
                                FilterChange::Copy { id, name } => {
                                    FilterService::copy_in(c, &id, &name).await?
                                }
                                FilterChange::Delete { id, revision } => {
                                    FilterService::delete_in(c, &id, &revision).await?;
                                    return Ok(MutationOutcome::FilterDeleted { id });
                                }
                            };
                            Ok::<_, FilterError>(MutationOutcome::FilterSaved {
                                preset: saved.into(),
                            })
                        })
                    })
                    .await
                }
                .await;
                result.unwrap_or_else(|e: FilterError| MutationOutcome::FilterFailed {
                    reason: match &e {
                        FilterError::Absent => "absent",
                        FilterError::Conflict => "conflict",
                        FilterError::DuplicateName => "duplicate_name",
                        FilterError::BlankName | FilterError::Envelope => "invalid",
                        _ => "storage",
                    }
                    .into(),
                    message: e.to_string(),
                    uncertain: matches!(
                        e,
                        FilterError::Store(locus_store::api::StoreError::CommitOutcomeUnknown(_))
                    ),
                })
            },
        )
        .await
    }
}
