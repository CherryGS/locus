use crate::{
    error::MigrationError,
    step::{Input, Step},
};
use diesel_async::SimpleAsyncConnection;
use locus_store::api::{Context, TransactionFuture};

pub(super) const STEP: Step = Step {
    id: 3,
    name: "Initial media schema",
    run,
    inputs: &[
        Input {
            path: "steps/000000000003_locus_media_initial_schema.rs",
            contents: include_str!("000000000003_locus_media_initial_schema.rs"),
        },
        Input {
            path: "steps/000000000003_locus_media_initial_schema.sql",
            contents: include_str!("000000000003_locus_media_initial_schema.sql"),
        },
    ],
};
fn run(context: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        context
            .connection()
            .batch_execute(include_str!("000000000003_locus_media_initial_schema.sql"))
            .await?;
        Ok(())
    })
}
