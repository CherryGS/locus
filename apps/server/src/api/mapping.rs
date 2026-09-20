//! Result envelopes shared across domain adapters.
use super::{
    dto::TaskOutcome,
    error::{Diagnostic, FailureKind},
    file::{dto::CopyProgress, mapping::diagnostic},
};
use locus_file::api::AdmissionFailure;
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
pub(crate) fn executor(message: impl Into<String>) -> TaskOutcome {
    TaskOutcome::Failed {
        diagnostic: Diagnostic {
            kind: FailureKind::Executor,
            message: message.into(),
        },
        progress: None,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::{core::mapping as core_mapping, media::mapping as media_mapping};
    use locus_core::api::{self as core, CoreError};
    use locus_file::api::{self as file, FileError};
    use locus_media::api as media;
    use locus_store::api::StoreError;
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
    #[test]
    fn all_nested_commit_uncertainty_paths_are_typed() {
        fn uncertain() -> StoreError {
            StoreError::CommitOutcomeUnknown(diesel::result::Error::RollbackTransaction)
        }
        for error in [
            media::MediaError::Store(uncertain()),
            media::MediaError::Core(core::CoreError::Store(uncertain())),
            media::MediaError::File(file::FileError::Store(uncertain())),
            media::MediaError::File(file::FileError::Core(core::CoreError::Store(uncertain()))),
        ] {
            let value = serde_json::to_value(media_mapping::media(error)).unwrap();
            assert!(value.to_string().contains("commit_outcome_unknown"));
        }
        let value =
            serde_json::to_value(core_mapping::core(core::CoreError::Store(uncertain()))).unwrap();
        assert_eq!(
            value["error"]["diagnostic"]["kind"],
            "commit_outcome_unknown"
        );
    }
}
