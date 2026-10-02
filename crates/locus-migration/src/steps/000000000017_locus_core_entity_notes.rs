use crate::{
    error::MigrationError,
    step::{Input, Step},
};
use diesel_async::SimpleAsyncConnection;
use locus_store::api::{Context, TransactionFuture};

pub(super) const STEP: Step = Step {
    id: 17,
    name: "Entity notes",
    run,
    inputs: &[
        Input {
            path: "steps/000000000017_locus_core_entity_notes.rs",
            contents: include_str!("000000000017_locus_core_entity_notes.rs"),
        },
        Input {
            path: "steps/000000000017_locus_core_entity_notes.sql",
            contents: include_str!("000000000017_locus_core_entity_notes.sql"),
        },
    ],
};
fn run(c: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        c.connection()
            .batch_execute(include_str!("000000000017_locus_core_entity_notes.sql"))
            .await?;
        Ok(())
    })
}
