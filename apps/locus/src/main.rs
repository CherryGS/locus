mod startup;
mod storage;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    startup::run().await
}
