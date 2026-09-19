use crate::storage::{ApplicationStorage, configured_root};

pub async fn run() -> anyhow::Result<()> {
    let ApplicationStorage {
        session: _session,
        kernel: _kernel,
        files: _files,
    } = ApplicationStorage::open(configured_root()?).await?;
    println!("Hello, world!");
    Ok(())
}
