use crate::{
    error::MigrationError,
    step::{Input, Step},
};
use diesel_async::SimpleAsyncConnection;
use locus_store::api::{Context, TransactionFuture};

pub(super) const STEP: Step = Step {
    id: 4,
    name: "Initial model schema",
    run,
    inputs: &[
        Input {
            path: "steps/s004_model.rs",
            contents: include_str!("s004_model.rs"),
        },
        Input {
            path: "steps/s004_model.sql",
            contents: include_str!("s004_model.sql"),
        },
    ],
};
fn run(context: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        context
            .connection()
            .batch_execute(include_str!("s004_model.sql"))
            .await?;
        Ok(())
    })
}
