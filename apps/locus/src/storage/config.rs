use anyhow::{Context, anyhow};
use std::path::PathBuf;

/// Runtime composition owned by the application; libraries never read environment.
pub fn configured_root() -> anyhow::Result<PathBuf> {
    if let Some(root) = std::env::var_os("LOCUS_DATA_DIR") {
        if root.is_empty() {
            return Err(anyhow!("LOCUS_DATA_DIR must not be empty"));
        }
        return Ok(PathBuf::from(root));
    }
    let base = directories::BaseDirs::new().context("resolve local application-data directory")?;
    // BaseDirs adds no application/vendor/data suffix: Windows is LocalAppData/Locus.
    Ok(base.data_local_dir().join("Locus"))
}
