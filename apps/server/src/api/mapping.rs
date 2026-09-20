use super::{
    dto::*,
    error::{ApiError, ErrorCode},
};
use locus_core::api::CoreError;
use locus_file::api::{AccessCause, AdmissionFailure, FileError, FileRecord};
use locus_store::api::StoreError;

pub(crate) fn metadata(file: FileRecord) -> FileMetadata {
    FileMetadata {
        file_id: file.id.to_string(),
        kind_id: locus_file::api::FILE_KIND.to_string(),
        relative_path: file.relative_path,
        byte_count: file.byte_count.to_string(),
    }
}
pub(crate) fn failure(error: AdmissionFailure) -> TaskOutcome {
    let progress = error.progress;
    TaskOutcome::Failed {
        diagnostic: diagnostic(&error.source),
        progress: Some(CopyProgress {
            file_id: progress.id.to_string(),
            relative_path: progress.relative_path,
            bytes_written: progress.bytes_written.to_string(),
            managed_bytes_may_exist: progress.managed_bytes_may_exist,
            copy_complete: progress.copy_complete,
        }),
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
pub(crate) fn executor(message: impl Into<String>) -> TaskOutcome {
    TaskOutcome::Failed {
        diagnostic: Diagnostic {
            kind: FailureKind::Executor,
            message: message.into(),
        },
        progress: None,
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
        diagnostic: Some(super::media_dto::DomainDiagnostic::File {
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
    #[test]
    fn typed_wrappers_preserve_uncertain_commit_and_exact_progress() {
        for source in [
            FileError::Store(StoreError::CommitOutcomeUnknown(
                diesel::result::Error::RollbackTransaction,
            )),
            FileError::Core(CoreError::Store(StoreError::CommitOutcomeUnknown(
                diesel::result::Error::RollbackTransaction,
            ))),
        ] {
            let progress = locus_file::api::CopyProgress {
                id: locus_file::api::FileId::from_bytes(uuid::Uuid::now_v7().as_bytes()).unwrap(),
                root: "ignored".into(),
                relative_path: "object/known".into(),
                bytes_written: 9_007_199_254_740_993,
                managed_bytes_may_exist: true,
                copy_complete: true,
            };
            let value = failure(AdmissionFailure {
                source,
                progress: Box::new(progress),
            });
            let json = serde_json::to_value(value).unwrap();
            assert_eq!(json["diagnostic"]["kind"], "commit_outcome_unknown");
            assert_eq!(json["progress"]["bytes_written"], "9007199254740993");
            assert_eq!(json["progress"]["copy_complete"], true);
        }
    }
}
