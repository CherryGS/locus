use crate::{
    error::MigrationError,
    step::{Input, Step},
};
use diesel_async::SimpleAsyncConnection;
use locus_store::api::{Context, TransactionFuture};

pub(super) const STEP: Step = Step {
    id: 18,
    name: "Entity card cover preferences",
    run,
    inputs: &[
        Input {
            path: "steps/000000000018_locus_server_entity_card_cover_preferences.rs",
            contents: include_str!("000000000018_locus_server_entity_card_cover_preferences.rs"),
        },
        Input {
            path: "steps/000000000018_locus_server_entity_card_cover_preferences.sql",
            contents: include_str!("000000000018_locus_server_entity_card_cover_preferences.sql"),
        },
    ],
};
fn run(c: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        c.connection()
            .batch_execute(include_str!(
                "000000000018_locus_server_entity_card_cover_preferences.sql"
            ))
            .await?;
        Ok(())
    })
}
