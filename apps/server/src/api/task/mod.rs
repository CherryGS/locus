//! HTTP adapter for locus-task; transport types remain server-owned.
pub(crate) mod dto;
mod handlers;
pub use dto::*;
pub(crate) use handlers::router;
