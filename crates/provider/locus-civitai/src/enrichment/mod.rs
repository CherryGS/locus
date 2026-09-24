mod confirmation;
mod metadata;
mod state;
mod uncertainty;
pub(crate) use metadata::fail;
pub(crate) use state::Captured;
pub(crate) use uncertainty::{file_uncertain, uncertain};
#[cfg(test)]
mod tests;
pub use state::{Enrichment, EnrichmentState, MetadataState};
