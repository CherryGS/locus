use crate::{
    error::CivitaiError,
    snapshot::{Model, ModelVersion, PreviewImage},
};
use provider_civitai::capability::{model_detail, model_version_by_hash, preview_image};
use std::{future::Future, pin::Pin, time::Duration};

pub type ProviderFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, CivitaiError>> + Send + 'a>>;
pub struct AcquiredMedia {
    pub bytes: Vec<u8>,
    pub content_type: String,
}
pub trait Upstream: Send + Sync {
    /// None is reserved for a definite lookup no-match, never a failed response.
    fn by_hash(&self, hash: [u8; 32]) -> ProviderFuture<'_, Option<ModelVersion>>;
    fn model(&self, id: u64) -> ProviderFuture<'_, Model>;
    fn example<'a>(&'a self, image: &'a PreviewImage) -> ProviderFuture<'a, AcquiredMedia>;
}
pub(crate) struct LiveUpstream {
    client: reqwest::Client,
}
impl LiveUpstream {
    pub fn new() -> Result<Self, CivitaiError> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|e| CivitaiError::Acquisition(e.to_string()))?;
        Ok(Self { client })
    }
}
impl Upstream for LiveUpstream {
    fn by_hash(&self, hash: [u8; 32]) -> ProviderFuture<'_, Option<ModelVersion>> {
        Box::pin(async move {
            match model_version_by_hash::call(&self.client, hash.into()).await {
                Ok(v) => Ok(Some(v.into())),
                Err(model_version_by_hash::Error::Response { status, .. })
                    if status == reqwest::StatusCode::NOT_FOUND =>
                {
                    Ok(None)
                }
                Err(e) => Err(CivitaiError::Acquisition(e.to_string())),
            }
        })
    }
    fn model(&self, id: u64) -> ProviderFuture<'_, Model> {
        Box::pin(async move {
            model_detail::call(&self.client, id)
                .await
                .map(Into::into)
                .map_err(|e| CivitaiError::Acquisition(e.to_string()))
        })
    }
    fn example<'a>(&'a self, image: &'a PreviewImage) -> ProviderFuture<'a, AcquiredMedia> {
        Box::pin(async move {
            if image
                .kind
                .as_deref()
                .is_some_and(|k| !k.eq_ignore_ascii_case("image"))
            {
                return Err(CivitaiError::Acquisition("The selected provider adapter supports image representations only; a poster cannot complete a video example".into()));
            }
            let image = provider_civitai::model::PreviewImage {
                id: image.id,
                url: image.url.clone(),
                nsfw_level: image.nsfw_level,
                width: image.width,
                height: image.height,
                hash: image.hash.clone(),
                kind: image.kind.clone(),
                extra: image.extra.clone(),
            };
            let result = preview_image::call(&self.client, &image)
                .await
                .map_err(|e| CivitaiError::Acquisition(e.to_string()))?;
            Ok(AcquiredMedia {
                bytes: result.bytes.to_vec(),
                content_type: result.content_type,
            })
        })
    }
}
