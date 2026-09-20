//! Explicit storage composition probe for the registered backend domains.

#[path = "storage/mod.rs"]
mod storage;

use storage::{ApplicationStorage, configured_root};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let ApplicationStorage {
        session: _session,
        kernel: _kernel,
        files: _files,
        media: _media,
        twitter: _twitter,
    } = ApplicationStorage::open(configured_root()?).await?;
    println!("File backend initialized.");
    Ok(())
}
