use super::dto::*;
use crate::api::error::{ApiError, Diagnostic, DomainDiagnostic, ErrorCode, FailureKind};
use locus_core::api::CoreError;
use locus_file::api::{AccessCause, FileError, FileRecord};
use locus_store::api::StoreError;
pub(crate) fn metadata(file: FileRecord) -> FileMetadata {
    FileMetadata {
        file_id: file.id.to_string(),
        kind_id: locus_file::api::FILE_KIND.to_string(),
        relative_path: file.relative_path,
        byte_count: file.byte_count.to_string(),
    }
}

pub(crate) fn current(input: locus_file::api::CurrentInput) -> CurrentInput {
    match input {
        locus_file::api::CurrentInput::File(id) => CurrentInput::File {
            file_id: id.to_string(),
        },
        locus_file::api::CurrentInput::MissingEntity(id) => CurrentInput::MissingEntity {
            entity_id: id.to_string(),
        },
        locus_file::api::CurrentInput::MissingSlot(id) => CurrentInput::MissingSlot {
            entity_id: id.to_string(),
        },
    }
}
pub(crate) fn diagnostic(error: &FileError) -> Diagnostic {
    // Match typed wrappers explicitly: transparent Error::source chains can omit
    // StoreError itself and lose the durable commit-uncertainty distinction.
    let kind = match error {
        FileError::Store(StoreError::CommitOutcomeUnknown(_))
        | FileError::Core(CoreError::Store(StoreError::CommitOutcomeUnknown(_))) => {
            FailureKind::CommitOutcomeUnknown
        }
        FileError::Io { source, .. } | FileError::CopyRead(source) => match source.kind() {
            std::io::ErrorKind::NotFound => FailureKind::InputMissing,
            std::io::ErrorKind::PermissionDenied => FailureKind::AccessDenied,
            _ => FailureKind::Io,
        },
        FileError::NotRegularFile => FailureKind::NotRegularFile,
        FileError::Access { cause, .. } => match cause {
            AccessCause::MissingBytes(_) => FailureKind::ManagedBytesMissing,
            AccessCause::Denied(_) => FailureKind::AccessDenied,
            AccessCause::Io(_) => FailureKind::Io,
        },
        FileError::Store(_)
        | FileError::Database(_)
        | FileError::Core(CoreError::Store(_) | CoreError::Database(_)) => FailureKind::Database,
        FileError::Worker(_) | FileError::Task(_) => FailureKind::Executor,
        _ => FailureKind::Domain,
    };
    Diagnostic {
        kind,
        message: error.to_string(),
    }
}
pub(crate) fn read_error(error: FileError) -> ApiError {
    let code = if matches!(error, FileError::MissingRecord(_)) {
        ErrorCode::MissingFile
    } else {
        ErrorCode::OperationFailed
    };
    ApiError {
        code,
        message: error.to_string(),
        diagnostic: Some(DomainDiagnostic::File {
            diagnostic: diagnostic(&error),
        }),
    }
}
pub(crate) fn access_error(error: FileError) -> ApiError {
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
            diagnostic: diagnostic(&error),
        }),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn managed_access_failures_preserve_missing_denied_and_io() {
        let id = locus_file::api::FileId::from_bytes(uuid::Uuid::now_v7().as_bytes()).unwrap();
        for (cause, expected) in [
            (
                AccessCause::MissingBytes(std::io::ErrorKind::NotFound.into()),
                FailureKind::ManagedBytesMissing,
            ),
            (
                AccessCause::Denied(std::io::ErrorKind::PermissionDenied.into()),
                FailureKind::AccessDenied,
            ),
            (
                AccessCause::Io(std::io::ErrorKind::Other.into()),
                FailureKind::Io,
            ),
        ] {
            assert_eq!(diagnostic(&FileError::Access { id, cause }).kind, expected);
        }
    }
}
