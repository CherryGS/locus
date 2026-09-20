use super::dto::*;
use crate::api::{
    error::{ApiError, DomainDiagnostic},
    request::canonical_id,
    store,
};
use locus_core::api as core;
pub(crate) fn core_failure(error: &core::CoreError) -> CoreFailure {
    use core::CoreError as E;
    match error {
        E::MissingEntity(id) => CoreFailure::MissingEntity {
            entity_id: id.to_string(),
        },
        E::MissingComponent(id) => CoreFailure::MissingComponent {
            component_id: id.to_string(),
        },
        E::SlotOccupied(id) => CoreFailure::SlotOccupied {
            component_id: id.to_string(),
        },
        E::AttachmentOccupied(m) => CoreFailure::AttachmentOccupied {
            membership: membership(*m),
        },
        E::KindMismatch {
            component,
            actual,
            requested,
        } => CoreFailure::KindMismatch {
            component_id: component.to_string(),
            actual: actual.to_string(),
            requested: requested.to_string(),
        },
        E::UnavailableKind(id) => CoreFailure::UnavailableKind {
            kind_id: id.to_string(),
        },
        E::Store(e) => CoreFailure::Store {
            diagnostic: store::diagnostic(e),
        },
        _ => CoreFailure::Other {
            message: error.to_string(),
        },
    }
}
pub(crate) fn core(error: core::CoreError) -> DomainDiagnostic {
    DomainDiagnostic::Core {
        error: core_failure(&error),
    }
}
pub(crate) fn membership(m: core::Membership) -> Membership {
    Membership {
        entity_id: m.entity.to_string(),
        kind_id: m.kind.to_string(),
        component_id: m.component.to_string(),
    }
}
pub(crate) fn entity(id: &str) -> Result<locus_core::api::EntityId, ApiError> {
    locus_core::api::EntityId::from_bytes(canonical_id(id)?.as_bytes())
        .map_err(|_| ApiError::invalid("entity_id must be UUIDv7"))
}
pub(crate) fn membership_input(m: &Membership) -> Result<locus_core::api::Membership, ApiError> {
    Ok(locus_core::api::Membership {
        entity: entity(&m.entity_id)?,
        kind: locus_core::api::KindId::from_uuid(canonical_id(&m.kind_id)?),
        component: locus_core::api::ComponentId::from_bytes(
            canonical_id(&m.component_id)?.as_bytes(),
        )
        .map_err(|_| ApiError::invalid("component_id must be UUIDv7"))?,
    })
}
