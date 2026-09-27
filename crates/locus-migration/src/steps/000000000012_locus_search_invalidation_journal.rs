use crate::{
    error::MigrationError,
    step::{Input, Step},
};
use diesel_async::SimpleAsyncConnection;
use locus_store::api::{Context, TransactionFuture};
pub(super) const STEP: Step = Step {
    id: 12,
    name: "Transactional search journal",
    run,
    inputs: &[
        Input {
            path: "steps/000000000012_locus_search_invalidation_journal.rs",
            contents: include_str!("000000000012_locus_search_invalidation_journal.rs"),
        },
        Input {
            path: "steps/000000000012_locus_search_invalidation_journal.sql",
            contents: include_str!("000000000012_locus_search_invalidation_journal.sql"),
        },
    ],
};
fn run(c: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        c.connection()
            .batch_execute(include_str!(
                "000000000012_locus_search_invalidation_journal.sql"
            ))
            .await?;
        Ok(())
    })
}
