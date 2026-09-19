use crate::{
    error::AttemptFailure, facts::Facts, identity::MediaId, input::InputContext,
    record::MediaRecord,
};

/// An opaque observation tied to this component, observed host/File and revision.
/// Dropping preparation writes no record. Decoder work never holds a DB transaction.
pub struct PreparedInterpretation {
    pub(super) id: MediaId,
    pub(super) revision: i64,
    pub(super) observed: InputContext,
    pub(super) result: Result<Facts, AttemptFailure>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ApplyOutcome {
    Accepted(MediaRecord),
    RejectedContextChanged,
    RejectedNewerAttempt,
}
