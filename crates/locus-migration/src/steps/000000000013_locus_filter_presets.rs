use crate::{
    error::MigrationError,
    step::{Input, Step},
};
use diesel_async::SimpleAsyncConnection;
use locus_store::api::{Context, TransactionFuture};
pub(super) const STEP: Step = Step {
    id: 13,
    name: "Library Filter presets",
    run,
    inputs: &[
        Input {
            path: "steps/000000000013_locus_filter_presets.rs",
            contents: include_str!("000000000013_locus_filter_presets.rs"),
        },
        Input {
            path: "steps/000000000013_locus_filter_presets.sql",
            contents: include_str!("000000000013_locus_filter_presets.sql"),
        },
    ],
};
fn run(c: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        c.connection()
            .batch_execute(include_str!("000000000013_locus_filter_presets.sql"))
            .await?;
        Ok(())
    })
}
