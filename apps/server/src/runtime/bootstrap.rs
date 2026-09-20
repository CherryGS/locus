use anyhow::{Context, bail};
use serde::{Deserialize, Serialize};
use std::{io::Read, path::PathBuf};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bootstrap {
    pub credential: String,
    pub library_root: Option<PathBuf>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Ready {
    pub origin: String,
    pub run_id: String,
}

impl Bootstrap {
    /// One bounded JSON object followed by EOF on a private inherited pipe.
    pub fn read(reader: impl Read) -> anyhow::Result<Self> {
        let mut bytes = Vec::new();
        reader
            .take(16_385)
            .read_to_end(&mut bytes)
            .context("read private bootstrap pipe")?;
        if bytes.len() > 16_384 {
            bail!("bootstrap exceeds 16384 bytes");
        }
        // Never echo malformed content or serde diagnostics containing a value.
        let value: Self = serde_json::from_slice(&bytes)
            .map_err(|_| anyhow::anyhow!("invalid bootstrap JSON"))?;
        validate_credential(&value.credential)?;
        Ok(value)
    }
    pub fn into_config(self) -> anyhow::Result<super::registry::ServerConfig> {
        let root = match self.library_root {
            Some(root) => root,
            None => configured_root()?,
        };
        if !root.is_absolute() {
            bail!("library_root must be absolute");
        }
        Ok(super::registry::ServerConfig::new(self.credential, root))
    }
}

pub(super) fn validate_credential(value: &str) -> anyhow::Result<()> {
    if !(32..=256).contains(&value.len())
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-._~".contains(&byte))
    {
        bail!("credential must contain 32 to 256 ASCII token characters");
    }
    Ok(())
}
fn configured_root() -> anyhow::Result<PathBuf> {
    if let Some(root) = std::env::var_os("LOCUS_DATA_DIR") {
        if root.is_empty() {
            bail!("LOCUS_DATA_DIR must not be empty");
        }
        return Ok(root.into());
    }
    Ok(directories::BaseDirs::new()
        .context("resolve local application-data directory")?
        .data_local_dir()
        .join("Locus"))
}
