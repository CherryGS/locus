use crate::{
    adapters::{LiveUpstream, Upstream},
    error::CivitaiError,
};
use std::sync::Arc;

#[derive(Clone)]
pub struct CivitaiService {
    pub(crate) upstream: Arc<dyn Upstream>,
}
impl CivitaiService {
    pub fn new() -> Result<Self, CivitaiError> {
        Ok(Self::with_upstream(Arc::new(LiveUpstream::new()?)))
    }
    /// Only acquisition is injected; storage, matching and all owner operations stay real.
    pub fn with_upstream(upstream: Arc<dyn Upstream>) -> Self {
        Self { upstream }
    }
}
