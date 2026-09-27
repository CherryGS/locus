use crate::{
    error::MigrationError,
    step::{Input, Step},
};
use diesel_async::SimpleAsyncConnection;
use locus_store::api::{Context, TransactionFuture};

pub(super) const STEP: Step = Step {
    id: 8,
    name: "Initial settings schema",
    run,
    inputs: &[
        Input {
            path: "steps/s008_settings.rs",
            contents: include_str!("s008_settings.rs"),
        },
        Input {
            path: "steps/s008_settings.sql",
            contents: include_str!("s008_settings.sql"),
        },
    ],
};
fn run(context: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        context
            .connection()
            .batch_execute(include_str!("s008_settings.sql"))
            .await?;
        Ok(())
    })
}
