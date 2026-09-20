use super::registry::Shared;
use crate::api::{
    error::{ApiError, ErrorCode},
    mapping,
    media_dto::DomainDiagnostic,
    media_mapping,
};
use locus_file::api::{AccessCause, FileError, FileId};
use std::sync::Arc;

pub(crate) struct OpenedBytes {
    pub file: std::fs::File,
    pub length: u64,
}
async fn opened(
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
impl Shared {
    pub async fn original(self: &Arc<Self>, id: FileId) -> Result<OpenedBytes, ApiError> {
        let domain = self.domain.clone();
        self.query("Open original bytes", move |task| async move {
            let mut session = domain.database.session(&task).await.map_err(|e| {
                ApiError::domain(DomainDiagnostic::Store {
                    diagnostic: media_mapping::store(&e),
                })
            })?;
            let input = domain
                .files
                .local_path(&mut session, id)
                .await
                .map_err(file_error)?;
            opened(&task, move || input.handle().try_clone()).await
        })
        .await
    }
    pub async fn derived(self: &Arc<Self>, locator: String) -> Result<OpenedBytes, ApiError> {
        let preview = self.lock().previews.get(&locator).cloned().ok_or_else(|| {
            ApiError::new(
                ErrorCode::PreviewUnavailable,
                "Unknown preview locator in this run",
            )
        })?;
        let media = self.domain.media.clone();
        self.query("Open derived bytes",move |task|async move {
            let file=media.open_preview(&task,&preview).await.map_err(|e| {
                let code=if matches!(&e,locus_media::api::MediaError::PreviewAccess(e) if e.kind()==std::io::ErrorKind::PermissionDenied) { ErrorCode::AccessDenied } else { ErrorCode::OperationFailed };
                let mut error=ApiError::domain(media_mapping::media(e)); error.code=code; error
            })?.ok_or_else(||ApiError::new(ErrorCode::PreviewUnavailable,"Preview bytes are no longer available; generation is explicit"))?;
            opened(&task,move ||Ok(file)).await
        }).await
    }
}
fn file_error(error: FileError) -> ApiError {
    let code = match &error {
        FileError::MissingRecord(_) => ErrorCode::MissingFile,
        FileError::Access {
            cause: AccessCause::MissingBytes(_),
            ..
        } => ErrorCode::MissingBytes,
        FileError::Access {
            cause: AccessCause::Denied(_),
            ..
        } => ErrorCode::AccessDenied,
        _ => ErrorCode::OperationFailed,
    };
    ApiError {
        code,
        message: error.to_string(),
        diagnostic: Some(DomainDiagnostic::File {
            diagnostic: mapping::diagnostic(&error),
        }),
    }
}
