use crate::api::error::{ApiError, ErrorCode};
pub(crate) struct OpenedBytes {
    pub file: std::fs::File,
    pub length: u64,
}
pub(super) async fn opened(
    task: &locus_task::api::TaskContext,
    file: impl FnOnce() -> std::io::Result<std::fs::File> + Send + 'static,
) -> Result<OpenedBytes, ApiError> {
    let stage = task
        .enter("Resolve byte representation", &[])
        .await
        .map_err(|e| ApiError::new(ErrorCode::OperationFailed, e.to_string()))?;
    stage
        .spawn_blocking(move |_| {
            let file = file()?;
            let length = file.metadata()?.len();
            Ok::<_, std::io::Error>(OpenedBytes { file, length })
        })
        .await
        .map_err(|e| ApiError::new(ErrorCode::OperationFailed, e.to_string()))?
        .map_err(|e| ApiError::new(ErrorCode::OperationFailed, e.to_string()))
}
