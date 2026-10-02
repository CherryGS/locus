use crate::{
    error::MigrationError,
    step::{Input, Step},
};
use diesel_async::SimpleAsyncConnection;
use locus_store::api::{Context, TransactionFuture};
pub(super) const STEP: Step = Step {
    id: 15,
    name: "Single-parent Tag forest",
    run,
    inputs: &[
        Input {
            path: "steps/000000000015_locus_tag_forest.rs",
            contents: include_str!("000000000015_locus_tag_forest.rs"),
        },
        Input {
            path: "steps/000000000015_locus_tag_forest.sql",
            contents: include_str!("000000000015_locus_tag_forest.sql"),
        },
    ],
};
fn run(c: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        c.connection()
            .batch_execute(include_str!("000000000015_locus_tag_forest.sql"))
            .await?;
        Ok(())
    })
}
