use locus_civitai::api::*;
pub(super) struct NoMatch;
impl Upstream for NoMatch {
    fn by_hash(&self, _: [u8; 32]) -> ProviderFuture<'_, Option<ModelVersion>> {
        Box::pin(async { Ok(None) })
    }
    fn model(&self, _: u64) -> ProviderFuture<'_, Model> {
        Box::pin(async {
            Err(CivitaiError::Acquisition(
                "Unexpected test parent lookup".into(),
            ))
        })
    }
    fn example<'a>(&'a self, _: &'a PreviewImage) -> ProviderFuture<'a, AcquiredMedia> {
        Box::pin(async {
            Err(CivitaiError::Acquisition(
                "Unexpected test example lookup".into(),
            ))
        })
    }
}
