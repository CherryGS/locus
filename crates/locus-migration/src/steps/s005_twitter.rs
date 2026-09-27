use crate::{
    error::MigrationError,
    step::{Input, Step},
};
use diesel_async::SimpleAsyncConnection;
use locus_store::api::{Context, TransactionFuture};

pub(super) const STEP: Step = Step {
    id: 5,
    name: "Initial twitter schema",
    run,
    inputs: &[
        Input {
            path: "steps/s005_twitter.rs",
            contents: include_str!("s005_twitter.rs"),
        },
        Input {
            path: "steps/s005_twitter.sql",
            contents: include_str!("s005_twitter.sql"),
        },
    ],
};
fn run(context: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        context
            .connection()
            .batch_execute(include_str!("s005_twitter.sql"))
            .await?;
        Ok(())
    })
}
