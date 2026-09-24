//! Isolated verification host. Only external provider responses are substituted.
//! Production server never reads this fixture configuration or environment variable.
use anyhow::Context;
use locus_civitai::api::{
    AcquiredMedia, CivitaiError, Model, ModelVersion, PreviewImage, ProviderFuture, Upstream,
};
use locus_server::api::{Bootstrap, Server};
use serde::Deserialize;
use std::{collections::BTreeMap, io::Write, path::PathBuf, sync::Arc};
#[derive(Deserialize, Default)]
struct Fixture {
    #[serde(default)]
    lookups: BTreeMap<String, ModelVersion>,
    #[serde(default)]
    models: BTreeMap<String, Model>,
    #[serde(default)]
    examples: BTreeMap<String, PathBuf>,
}
struct Controlled {
    path: Option<PathBuf>,
}
impl Controlled {
    fn read(&self) -> Result<Fixture, CivitaiError> {
        match &self.path {
            None => Ok(Fixture::default()),
            Some(path) => serde_json::from_slice(&std::fs::read(path)?)
                .map_err(|e| CivitaiError::Acquisition(e.to_string())),
        }
    }
}
impl Upstream for Controlled {
    fn by_hash(&self, hash: [u8; 32]) -> ProviderFuture<'_, Option<ModelVersion>> {
        Box::pin(async move {
            let key = hash.iter().map(|b| format!("{b:02x}")).collect::<String>();
            Ok(self.read()?.lookups.remove(&key))
        })
    }
    fn model(&self, id: u64) -> ProviderFuture<'_, Model> {
        Box::pin(async move {
            self.read()?
                .models
                .remove(&id.to_string())
                .ok_or_else(|| CivitaiError::Acquisition("Controlled parent unavailable".into()))
        })
    }
    fn example<'a>(&'a self, image: &'a PreviewImage) -> ProviderFuture<'a, AcquiredMedia> {
        Box::pin(async move {
            let path = self.read()?.examples.remove(&image.url).ok_or_else(|| {
                CivitaiError::Acquisition("Controlled example unavailable".into())
            })?;
            Ok(AcquiredMedia {
                bytes: tokio::fs::read(path).await?,
                content_type: "image/png".into(),
            })
        })
    }
}
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut config = Bootstrap::read(std::io::stdin().lock())?.into_config()?;
    if std::env::var_os("LOCUS_FIXTURE_EXTERNAL_EPHEMERAL").is_some() {
        config.external_address_override = Some("127.0.0.1:0".parse()?);
    }
    config.civitai_upstream = Some(Arc::new(Controlled {
        path: std::env::var_os("LOCUS_CIVITAI_FIXTURE").map(PathBuf::from),
    }));
    let server = Server::bind(config)
        .await
        .context("start isolated fixture host")?;
    writeln!(
        std::io::stdout().lock(),
        "{}",
        serde_json::to_string(&server.ready())?
    )?;
    std::io::stdout().flush()?;
    server.serve().await
}
