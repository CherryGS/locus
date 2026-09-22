#[path = "twitter-fixture/mod.rs"]
mod fixture;
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let root = std::env::args_os().nth(1).ok_or_else(|| {
        anyhow::anyhow!("usage: twitter-reading-fixture ABSOLUTE_NEW_LIBRARY_ROOT")
    })?;
    let video = std::env::args_os()
        .nth(2)
        .filter(|v| !v.is_empty())
        .map(std::path::PathBuf::from);
    println!(
        "{}",
        fixture::seed(std::path::Path::new(&root), video.as_deref()).await?
    );
    Ok(())
}
