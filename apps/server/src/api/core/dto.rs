use crate::api::error::Diagnostic;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Membership {
    pub entity_id: String,
    pub kind_id: String,
    pub component_id: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ChangeMembership {
    pub request_id: String,
    pub membership: Membership,
}
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum CoreFailure {
    MissingEntity {
        entity_id: String,
    },
    MissingComponent {
        component_id: String,
    },
    SlotOccupied {
        component_id: String,
    },
    AttachmentOccupied {
        membership: Membership,
    },
    KindMismatch {
        component_id: String,
        actual: String,
        requested: String,
    },
    UnavailableKind {
        kind_id: String,
    },
    Store {
        diagnostic: Diagnostic,
    },
    Other {
        message: String,
    },
}
