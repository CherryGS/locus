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
            path: "steps/s012_search.rs",
            contents: include_str!("s012_search.rs"),
        },
        Input {
            path: "steps/s012_search.sql",
            contents: include_str!("s012_search.sql"),
        },
    ],
};
fn run(c: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        c.connection()
            .batch_execute(include_str!("s012_search.sql"))
            .await?;
        Ok(())
    })
}
