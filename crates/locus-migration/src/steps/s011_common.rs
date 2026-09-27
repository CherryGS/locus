use crate::{
    error::MigrationError,
    step::{Input, Step},
};
use diesel_async::SimpleAsyncConnection;
use locus_store::api::{Context, TransactionFuture};
pub(super) const STEP: Step = Step {
    id: 11,
    name: "Domain common columns",
    run,
    inputs: &[
        Input {
            path: "steps/s011_common.rs",
            contents: include_str!("s011_common.rs"),
        },
        Input {
            path: "steps/s011_common.sql",
            contents: include_str!("s011_common.sql"),
        },
        Input {
            path: "steps/s011_conversion.rs",
            contents: include_str!("s011_conversion.rs"),
        },
    ],
};
fn run(c: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        c.connection()
            .batch_execute(include_str!("s011_common.sql"))
            .await?;
        super::s011_conversion::convert(c).await
    })
}
