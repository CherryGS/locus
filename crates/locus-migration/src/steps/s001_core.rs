use crate::{
    error::MigrationError,
    step::{Input, Step},
};
use diesel_async::SimpleAsyncConnection;
use locus_store::api::{Context, TransactionFuture};

pub(super) const STEP: Step = Step {
    id: 1,
    name: "Initial core schema",
    run,
    inputs: &[
        Input {
            path: "steps/s001_core.rs",
            contents: include_str!("s001_core.rs"),
        },
        Input {
            path: "steps/s001_core.sql",
            contents: include_str!("s001_core.sql"),
        },
    ],
};
fn run(context: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        context
            .connection()
            .batch_execute(include_str!("s001_core.sql"))
            .await?;
        Ok(())
    })
}
