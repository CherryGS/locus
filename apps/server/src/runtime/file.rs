use super::{
    bytes::{OpenedBytes, opened},
    registry::Shared,
};
use crate::api::{
    dto::*,
    error::{ApiError, Diagnostic, ErrorCode, FailureKind},
    file::{dto::*, mapping as file_mapping},
    mapping, store,
};
use locus_file::api::FileId;
use std::sync::Arc;
impl Shared {
    pub fn import(self: &Arc<Self>, request: ImportRequest) -> Result<Receipt, ApiError> {
        let domain = self.business()?.clone();
        let source = request.source_path.clone();
        self.public(
            request.request_id.clone(),
            super::submissions::Arguments::Import(request),
            "Import File",
            move |task| async move {
                let mut session = match domain.database.session(&task).await {
                    Ok(session) => session,
                    Err(error) => {
                        return TaskOutcome::Failed {
                            diagnostic: Diagnostic {
                                kind: FailureKind::Database,
                                message: error.to_string(),
                            },
                            progress: None,
                        };
                    }
                };
                match domain
                    .files
                    .admit(&domain.kernel, &mut session, source)
                    .await
                {
                    Ok(file) => TaskOutcome::Imported {
                        file: file_mapping::metadata(file),
                    },
                    Err(error) => mapping::failure(error),
                }
            },
        )
    }
    pub async fn read(self: &Arc<Self>, id: FileId) -> Result<FileMetadata, ApiError> {
        let domain = self.business()?.clone();
        let receiver = self.direct("Read File metadata", move |task| async move {
            let mut session =
                domain.database.session(&task).await.map_err(|error| {
                    ApiError::new(ErrorCode::OperationFailed, error.to_string())
                })?;
            domain
                .files
                .read(&mut session, id)
                .await
                .map(file_mapping::metadata)
                .map_err(file_mapping::read_error)
        })?;
        receiver
            .await
            .map_err(|_| {
                ApiError::new(
                    ErrorCode::OperationFailed,
                    "Direct operation supervisor was lost",
                )
            })?
            .map_err(|error| ApiError::new(ErrorCode::OperationFailed, error.to_string()))?
    }
    pub async fn original(self: &Arc<Self>, id: FileId) -> Result<OpenedBytes, ApiError> {
        let domain = self.business()?.clone();
        self.query("Open original bytes", move |task| async move {
            let mut session = domain
                .database
                .session(&task)
                .await
                .map_err(store::failure)?;
            let input = domain
                .files
                .local_path(&mut session, id)
                .await
                .map_err(file_mapping::access_error)?;
            opened(&task, move || input.handle().try_clone()).await
        })
        .await
    }
}
