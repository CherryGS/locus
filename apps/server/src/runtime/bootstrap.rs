use anyhow::{Context, bail};
use serde::{Deserialize, Serialize};
use std::{
    ffi::OsString,
    fs::File,
    io::{BufRead, BufReader, ErrorKind, Read},
    path::PathBuf,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bootstrap {
    pub credential: String,
    pub library_root: Option<PathBuf>,
    pub renderer_root: Option<PathBuf>,
    #[serde(default)]
    pub require_existing: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Ready {
    pub origin: String,
    pub run_id: String,
    pub library_root: PathBuf,
    pub availability: crate::api::dto::Availability,
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
        if self.require_existing && self.library_root.is_none() {
            bail!("Existing-library startup requires an explicit locator");
        }
        let root = resolve_root(
            self.library_root,
            std::env::var_os("LOCUS_DATA_DIR"),
            || {
                Ok(directories::BaseDirs::new()
                    .context("resolve local application-data directory")?
                    .data_local_dir()
                    .join("Locus"))
            },
        )?;
        let mut config = super::registry::ServerConfig::new(self.credential, root);
        config.renderer_root = self.renderer_root;
        config.require_existing = self.require_existing;
        Ok(config)
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
fn resolve_root(
    explicit_root: Option<PathBuf>,
    environment_root: Option<OsString>,
    application_data: impl FnOnce() -> anyhow::Result<PathBuf>,
) -> anyhow::Result<PathBuf> {
    let root = if let Some(root) = explicit_root {
        root
    } else if let Some(root) = environment_root {
        if root.is_empty() {
            bail!("LOCUS_DATA_DIR must not be empty");
        }
        root.into()
    } else {
        root_from_path_file(application_data()?)?
    };
    if !root.is_absolute() {
        bail!("library_root must be absolute");
    }
    Ok(root)
}

fn root_from_path_file(application_data: PathBuf) -> anyhow::Result<PathBuf> {
    // The locator stays in application data even when the library lives elsewhere.
    // Only an absent/empty locator falls back; an unreadable one must not silently
    // open a different library.
    let locator = application_data.join("path");
    let file = match File::open(&locator) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(application_data),
        Err(error) => return Err(error).with_context(|| format!("open {}", locator.display())),
    };
    let mut line = String::new();
    BufReader::new(file)
        .read_line(&mut line)
        .with_context(|| format!("read first line of {}", locator.display()))?;
    let root = line.strip_prefix('\u{feff}').unwrap_or(&line).trim();
    Ok(if root.is_empty() {
        application_data
    } else {
        PathBuf::from(root)
    })
}

#[cfg(test)]
#[path = "bootstrap_tests.rs"]
mod tests;
