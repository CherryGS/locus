use crate::{FILE_KIND, FileError, FileId};
use locus_core::{CoreError, EntityId, Kernel};
use locus_store::{Context, Session};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CurrentInput {
    File(FileId),
    MissingEntity(EntityId),
    MissingSlot(EntityId),
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputComparison {
    Matching(FileId),
    Changed {
        basis: FileId,
        current: FileId,
    },
    /// Missing basis and missing context can coexist without either hiding the other.
    Incomplete {
        basis: Option<FileId>,
        current: CurrentInput,
    },
}

/// Errors remain errors; no basis writes, byte probes or old-input fallback.
pub fn compare_input(
    basis: Option<FileId>,
    observed: Result<CurrentInput, FileError>,
) -> Result<InputComparison, FileError> {
    match (basis, observed?) {
        (Some(basis), CurrentInput::File(current)) if basis == current => {
            Ok(InputComparison::Matching(current))
        }
        (Some(basis), CurrentInput::File(current)) => {
            Ok(InputComparison::Changed { basis, current })
        }
        (basis, current) => Ok(InputComparison::Incomplete { basis, current }),
    }
}

/// Standalone observation describes this read, not a future acceptance boundary.
pub async fn observe_input(
    kernel: &Kernel,
    session: &mut Session,
    entity: EntityId,
) -> Result<CurrentInput, FileError> {
    let kernel = kernel.clone();
    session
        .transaction(move |context| {
            Box::pin(async move { observe_input_in(&kernel, context, entity).await })
        })
        .await
}

/// Observe actual membership inside the caller's transaction. A known FileId is
/// separate from its payload/byte availability. Consumers establish their own host
/// entity and coordinate this check with their acceptance writes/commit.
pub async fn observe_input_in(
    kernel: &Kernel,
    context: &mut Context,
    entity: EntityId,
) -> Result<CurrentInput, FileError> {
    let memberships = match kernel.memberships_in(context, entity).await {
        Ok(memberships) => memberships,
        Err(CoreError::MissingEntity(_)) => return Ok(CurrentInput::MissingEntity(entity)),
        Err(error) => return Err(error.into()),
    };
    Ok(memberships
        .into_iter()
        .find(|membership| membership.kind == FILE_KIND)
        .map_or(CurrentInput::MissingSlot(entity), |membership| {
            CurrentInput::File(FileId::from_component(membership.component))
        }))
}
