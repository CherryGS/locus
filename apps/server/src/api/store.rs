//! Store diagnostics used by the higher-level HTTP adapters.
use super::error::{Diagnostic, FailureKind};
use locus_store::api::StoreError;
pub(crate) fn diagnostic(error: &StoreError) -> Diagnostic {
    Diagnostic {
        kind: if matches!(error, StoreError::CommitOutcomeUnknown(_)) {
            FailureKind::CommitOutcomeUnknown
        } else {
            FailureKind::Database
        },
        message: error.to_string(),
    }
}
