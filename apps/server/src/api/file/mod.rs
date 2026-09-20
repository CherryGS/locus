//! HTTP adapter for locus-file; transport types remain server-owned.
pub(crate) mod dto;
mod handlers;
pub(crate) mod mapping;
pub use dto::*;
pub(crate) use handlers::router;
