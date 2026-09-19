//! Explicit backend composition probe; the native mock shell remains the default.

#[path = "../src/storage.rs"]
mod storage;

use storage::{ApplicationStorage, configured_root};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let ApplicationStorage {
        session: _session,
        kernel: _kernel,
        files: _files,
    } = ApplicationStorage::open(configured_root()?).await?;
    println!("File backend initialized.");
    Ok(())
}
