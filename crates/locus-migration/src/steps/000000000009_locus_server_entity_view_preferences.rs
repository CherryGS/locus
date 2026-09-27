use crate::{
    error::MigrationError,
    step::{Input, Step},
};
use diesel_async::SimpleAsyncConnection;
use locus_store::api::{Context, TransactionFuture};

pub(super) const STEP: Step = Step {
    id: 9,
    name: "Initial preferences schema",
    run,
    inputs: &[
        Input {
            path: "steps/000000000009_locus_server_entity_view_preferences.rs",
            contents: include_str!("000000000009_locus_server_entity_view_preferences.rs"),
        },
        Input {
            path: "steps/000000000009_locus_server_entity_view_preferences.sql",
            contents: include_str!("000000000009_locus_server_entity_view_preferences.sql"),
        },
    ],
};
fn run(context: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        context
            .connection()
            .batch_execute(include_str!(
                "000000000009_locus_server_entity_view_preferences.sql"
            ))
            .await?;
        Ok(())
    })
}
