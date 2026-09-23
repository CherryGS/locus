use super::dto::*;
use crate::api::{
    core::mapping as core, error::DomainDiagnostic, file::mapping as file,
    media::dto::Applicability, store,
};
use locus_model::api as model;
pub(crate) fn model(e: model::ModelError) -> DomainDiagnostic {
    use model::ModelError as E;
    DomainDiagnostic::Model {
        error: match e {
            E::Core(e) => ModelFailure::Core {
                error: core::core_failure(&e),
            },
            E::File(e) => ModelFailure::File {
                diagnostic: file::diagnostic(&e),
            },
            E::Store(e) => ModelFailure::Store {
                diagnostic: store::diagnostic(&e),
            },
            E::MissingRecord(id) => ModelFailure::MissingRecord {
                component_id: id.component().to_string(),
            },
            E::Corrupt(message) => ModelFailure::Corrupt { message },
            E::SchemaVersion(version) => ModelFailure::SchemaVersion { version },
            E::ContextChanged => ModelFailure::ContextChanged,
            E::NewerAttempt => ModelFailure::NewerAttempt,
            E::Attempt(f) => ModelFailure::Attempt {
                failure: attempt(f),
            },
            e => ModelFailure::Other {
                message: e.to_string(),
            },
        },
    }
}
fn attempt(f: model::AttemptFailure) -> ModelAttemptFailure {
    ModelAttemptFailure {
        code: match f.code {
            model::FailureCode::MissingInput => ModelAttemptCode::MissingInput,
            model::FailureCode::FileAccess => ModelAttemptCode::FileAccess,
            model::FailureCode::UnsupportedInput => ModelAttemptCode::UnsupportedInput,
            model::FailureCode::Structure => ModelAttemptCode::Structure,
            model::FailureCode::Worker => ModelAttemptCode::Worker,
        },
        detail: f.detail,
    }
}
pub(crate) fn record(r: model::ModelRecord) -> ModelRecord {
    ModelRecord {
        component_id: r.id.component().to_string(),
        revision: r.revision.to_string(),
        basis: r.basis.map(|v| v.to_string()),
        last_failure: r.last_failure.map(attempt),
        facts: r.facts.map(|f| ModelInspection {
            format: f.format,
            coverage: f.coverage,
            tensor_count: f.tensor_count.to_string(),
            element_count: f.element_count.to_string(),
            tensors: f
                .tensors
                .into_iter()
                .map(|t| ModelTensor {
                    name: t.name,
                    shape: t.shape.into_iter().map(|v| v.to_string()).collect(),
                    storage_type: t.storage_type,
                })
                .collect(),
            storage_types: f
                .storage_types
                .into_iter()
                .map(|(k, v)| {
                    (
                        k,
                        ModelStorageSummary {
                            tensor_count: v.tensor_count.to_string(),
                            element_count: v.element_count.to_string(),
                        },
                    )
                })
                .collect(),
            declarations: f.declarations,
        }),
    }
}
pub(crate) fn view(v: model::ModelView) -> ModelView {
    let host = match &v.context {
        Ok(model::InputContext::Hosted { host, .. }) => Some(host.to_string()),
        _ => None,
    };
    let applicability = match v.context {
        Err(e) => Applicability::Error {
            diagnostic: model(e),
        },
        Ok(model::InputContext::Unmounted) => Applicability::Unmounted,
        Ok(model::InputContext::Hosted { input, .. }) => match v.comparison {
            Some(locus_file::api::InputComparison::Matching(f)) => Applicability::Matching {
                file_id: f.to_string(),
            },
            Some(locus_file::api::InputComparison::Changed { basis, current }) => {
                Applicability::Changed {
                    basis: basis.to_string(),
                    current: current.to_string(),
                }
            }
            _ => Applicability::Incomplete {
                basis: v.record.basis.map(|v| v.to_string()),
                current: file::current(input),
            },
        },
    };
    ModelView {
        host,
        record: record(v.record),
        applicability,
        file_problem: v.file_problem.map(|e| DomainDiagnostic::File {
            diagnostic: file::diagnostic(&e),
        }),
    }
}
