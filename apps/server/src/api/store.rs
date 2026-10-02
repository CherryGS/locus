//! Store diagnostics used by the higher-level HTTP adapters.
use super::error::{ApiError, Diagnostic, DomainDiagnostic, FailureKind};
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

pub(crate) fn domain(error: StoreError) -> DomainDiagnostic {
    DomainDiagnostic::Store {
        diagnostic: diagnostic(&error),
    }
}
pub(crate) fn failure(error: StoreError) -> ApiError {
    ApiError::domain(domain(error))
}
