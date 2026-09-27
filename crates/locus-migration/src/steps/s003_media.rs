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
            path: "steps/s003_media.rs",
            contents: include_str!("s003_media.rs"),
        },
        Input {
            path: "steps/s003_media.sql",
            contents: include_str!("s003_media.sql"),
        },
    ],
};
fn run(context: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        context
            .connection()
            .batch_execute(include_str!("s003_media.sql"))
            .await?;
        Ok(())
    })
}
