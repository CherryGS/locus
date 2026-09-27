use super::Shared;
use crate::api::error::{ApiError, ErrorCode};
use std::sync::Arc;
impl Shared {
    pub async fn search_query(
        self: &Arc<Self>,
        service: locus_search::api::SearchService,
        input: locus_search::api::SearchRequest,
    ) -> Result<Result<locus_search::api::SearchResult, locus_search::api::SearchError>, ApiError>
    {
        self.query("Search Entities", move |task| async move {
            let stage = task
                .enter("Execute complete search", &[])
                .await
                .map_err(|e| ApiError::new(ErrorCode::OperationFailed, e.to_string()))?;
            stage
                .spawn_blocking(move |_| service.query(input))
                .await
                .map_err(|e| ApiError::new(ErrorCode::OperationFailed, e.to_string()))
        })
        .await
    }
    pub async fn search_evidence(
        self: &Arc<Self>,
        service: locus_search::api::SearchService,
        context: String,
        entities: Vec<locus_core::api::EntityId>,
    ) -> Result<Result<Vec<locus_search::api::Evidence>, locus_search::api::SearchError>, ApiError>
    {
        self.query("Search evidence", move |task| async move {
            let stage = task
                .enter("Read original search evidence", &[])
                .await
                .map_err(|e| ApiError::new(ErrorCode::OperationFailed, e.to_string()))?;
            stage
                .spawn_blocking(move |_| service.evidence(&context, &entities))
                .await
                .map_err(|e| ApiError::new(ErrorCode::OperationFailed, e.to_string()))
        })
        .await
    }
}
