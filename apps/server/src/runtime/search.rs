use super::Shared;
use crate::api::error::{ApiError, ErrorCode};
use std::sync::Arc;
impl Shared {
    pub async fn search_reference_choices(
        self: &Arc<Self>,
        service: locus_search::api::SearchService,
        reference: String,
    ) -> Result<
        Result<Vec<locus_query::api::ReferenceChoice>, locus_search::api::SearchError>,
        ApiError,
    > {
        self.query(
            "Read primary query reference choices",
            move |_task| async move { Ok(service.reference_choices(reference).await) },
        )
        .await
    }
    pub async fn search_observation(
        self: &Arc<Self>,
        service: locus_search::api::SearchService,
    ) -> Result<Result<locus_search::api::Observation, locus_search::api::SearchError>, ApiError>
    {
        self.query("Capture search discovery", move |_task| async move {
            Ok(service.observation().await)
        })
        .await
    }
    pub async fn search_strings(
        self: &Arc<Self>,
        service: locus_search::api::SearchService,
        input: locus_search::api::StringPageRequest,
    ) -> Result<Result<locus_search::api::StringPage, locus_search::api::SearchError>, ApiError>
    {
        self.query("Read original search values", move |task| async move {
            let stage = task
                .enter("Read pinned original values", &[])
                .await
                .map_err(|e| ApiError::new(ErrorCode::OperationFailed, e.to_string()))?;
            stage
                .spawn_blocking(move |_| service.string_page(input))
                .await
                .map_err(|e| ApiError::new(ErrorCode::OperationFailed, e.to_string()))
        })
        .await
    }
    pub async fn search_bounds(
        self: &Arc<Self>,
        service: locus_search::api::SearchService,
        input: locus_search::api::BoundsRequest,
    ) -> Result<Result<locus_search::api::Bounds, locus_search::api::SearchError>, ApiError> {
        self.query("Read search bounds", move |task| async move {
            let stage = task
                .enter("Read pinned typed bounds", &[])
                .await
                .map_err(|e| ApiError::new(ErrorCode::OperationFailed, e.to_string()))?;
            stage
                .spawn_blocking(move |_| service.bounds(input))
                .await
                .map_err(|e| ApiError::new(ErrorCode::OperationFailed, e.to_string()))
        })
        .await
    }
    pub async fn search_query(
        self: &Arc<Self>,
        service: locus_search::api::SearchService,
        input: locus_query::api::Program,
    ) -> Result<Result<locus_search::api::SearchResult, locus_search::api::SearchError>, ApiError>
    {
        self.query("Search Entities", move |_task| async move {
            Ok(service.query_program(input).await)
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
