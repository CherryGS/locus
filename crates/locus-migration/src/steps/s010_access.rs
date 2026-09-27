use crate::{
    error::MigrationError,
    step::{Input, Step},
};
use diesel_async::SimpleAsyncConnection;
use locus_store::api::{Context, TransactionFuture};

pub(super) const STEP: Step = Step {
    id: 10,
    name: "Initial access schema",
    run,
    inputs: &[
        Input {
            path: "steps/s010_access.rs",
            contents: include_str!("s010_access.rs"),
        },
        Input {
            path: "steps/s010_access.sql",
            contents: include_str!("s010_access.sql"),
        },
    ],
};
fn run(context: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        context
            .connection()
            .batch_execute(include_str!("s010_access.sql"))
            .await?;
        Ok(())
    })
}
