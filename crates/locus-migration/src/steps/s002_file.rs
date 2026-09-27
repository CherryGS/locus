use crate::{
    error::MigrationError,
    step::{Input, Step},
};
use diesel_async::SimpleAsyncConnection;
use locus_store::api::{Context, TransactionFuture};

pub(super) const STEP: Step = Step {
    id: 2,
    name: "Initial file schema",
    run,
    inputs: &[
        Input {
            path: "steps/s002_file.rs",
            contents: include_str!("s002_file.rs"),
        },
        Input {
            path: "steps/s002_file.sql",
            contents: include_str!("s002_file.sql"),
        },
    ],
};
fn run(context: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        context
            .connection()
            .batch_execute(include_str!("s002_file.sql"))
            .await?;
        Ok(())
    })
}
