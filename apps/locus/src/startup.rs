use anyhow::Context;
use locus_core::Kernel;
use locus_store::Session;

pub async fn run() -> anyhow::Result<()> {
    let mut session = Session::memory()
        .await
        .context("open bootstrap SQLite session")?;
    Kernel::new()
        .initialize(&mut session)
        .await
        .context("initialize identity kernel")?;
    println!("Hello, world!");
    Ok(())
}
