use crate::{
    error::MigrationError,
    step::{Input, Step},
};
use diesel_async::SimpleAsyncConnection;
use locus_store::api::{Context, TransactionFuture};

pub(super) const STEP: Step = Step {
    id: 16,
    name: "Tag Markdown document",
    run,
    inputs: &[
        Input {
            path: "steps/000000000016_locus_tag_markdown.rs",
            contents: include_str!("000000000016_locus_tag_markdown.rs"),
        },
        Input {
            path: "steps/000000000016_locus_tag_markdown.sql",
            contents: include_str!("000000000016_locus_tag_markdown.sql"),
        },
    ],
};
fn run(c: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        c.connection()
            .batch_execute(include_str!("000000000016_locus_tag_markdown.sql"))
            .await?;
        Ok(())
    })
}
