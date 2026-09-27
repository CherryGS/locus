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
            path: "steps/000000000011_locus_migration_common_query_columns.rs",
            contents: include_str!("000000000011_locus_migration_common_query_columns.rs"),
        },
        Input {
            path: "steps/000000000011_locus_migration_common_query_columns.sql",
            contents: include_str!("000000000011_locus_migration_common_query_columns.sql"),
        },
        Input {
            path: "steps/000000000011_locus_migration_common_query_columns_conversion.rs",
            contents: include_str!(
                "000000000011_locus_migration_common_query_columns_conversion.rs"
            ),
        },
    ],
};
fn run(c: &mut Context) -> TransactionFuture<'_, (), MigrationError> {
    Box::pin(async move {
        c.connection()
            .batch_execute(include_str!(
                "000000000011_locus_migration_common_query_columns.sql"
            ))
            .await?;
        super::s011_conversion::convert(c).await
    })
}
