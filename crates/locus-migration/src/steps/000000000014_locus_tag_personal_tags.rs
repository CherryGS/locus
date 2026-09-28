use crate::{
    error::MigrationError,
    step::{Input, Step},
};
use diesel_async::SimpleAsyncConnection;
use locus_store::api::{Context, TransactionFuture};
pub(super) const STEP: Step = Step {
    id: 14,
    name: "Personal Tag vocabulary and annotations",
    run,
    inputs: &[
        Input {
            path: "steps/000000000014_locus_tag_personal_tags.rs",
            contents: include_str!("000000000014_locus_tag_personal_tags.rs"),
        },
        Input {
            path: "steps/000000000014_locus_tag_personal_tags.sql",
            contents: include_str!("000000000014_locus_tag_personal_tags.sql"),
        },
    ],
};
fn run(c: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        c.connection()
            .batch_execute(include_str!("000000000014_locus_tag_personal_tags.sql"))
            .await?;
        Ok(())
    })
}
