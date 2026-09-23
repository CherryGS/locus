use crate::{
    error::AttemptFailure, identity::ModelId, input::InputContext, record::Inspection,
    record::ModelRecord,
};

/// An opaque observation tied to this component, observed host/File and revision.
/// Dropping preparation writes no record. Decoder work never holds a DB transaction.
pub struct PreparedInspection {
    pub(super) id: ModelId,
    pub(super) revision: i64,
    pub(super) observed: InputContext,
    pub(super) result: Result<Inspection, AttemptFailure>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ApplyOutcome {
    Accepted(Box<ModelRecord>),
    RejectedContextChanged,
    RejectedNewerAttempt,
}
