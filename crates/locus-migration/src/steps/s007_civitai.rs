use crate::{
    error::MigrationError,
    step::{Input, Step},
};
use diesel_async::SimpleAsyncConnection;
use locus_store::api::{Context, TransactionFuture};

pub(super) const STEP: Step = Step {
    id: 7,
    name: "Initial civitai schema",
    run,
    inputs: &[
        Input {
            path: "steps/s007_civitai.rs",
            contents: include_str!("s007_civitai.rs"),
        },
        Input {
            path: "steps/s007_civitai.sql",
            contents: include_str!("s007_civitai.sql"),
        },
    ],
};
fn run(context: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        context
            .connection()
            .batch_execute(include_str!("s007_civitai.sql"))
            .await?;
        Ok(())
    })
}
