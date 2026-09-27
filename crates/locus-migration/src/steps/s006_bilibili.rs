use crate::{
    error::MigrationError,
    step::{Input, Step},
};
use diesel_async::SimpleAsyncConnection;
use locus_store::api::{Context, TransactionFuture};

pub(super) const STEP: Step = Step {
    id: 6,
    name: "Initial bilibili schema",
    run,
    inputs: &[
        Input {
            path: "steps/s006_bilibili.rs",
            contents: include_str!("s006_bilibili.rs"),
        },
        Input {
            path: "steps/s006_bilibili.sql",
            contents: include_str!("s006_bilibili.sql"),
        },
    ],
};
fn run(context: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        context
            .connection()
            .batch_execute(include_str!("s006_bilibili.sql"))
            .await?;
        Ok(())
    })
}
