use crate::{error::MigrationError, persistence, step::Step, steps::STEPS};
use locus_store::api::Session;

/// Complete the known history before constructing current domain services.
/// The caller must retain exclusive library ownership through actual worker end.
/// An uncertain Store commit is preserved in the error chain; reopen and observe
/// durable history on the next explicit attempt, never infer rollback or retry here.
pub async fn migrate(session: &mut Session) -> Result<(), MigrationError> {
    execute(session, STEPS).await
}
pub(crate) async fn execute(
    session: &mut Session,
    steps: &'static [Step],
) -> Result<(), MigrationError> {
    if steps.windows(2).any(|pair| pair[0].id >= pair[1].id)
        || steps.iter().any(|s| s.id <= 0 || s.inputs.is_empty())
    {
        return Err(MigrationError::Incompatible(
            "invalid embedded catalog".into(),
        ));
    }
    let applied = session
        .transaction_named("Validate migration history", move |context| {
            Box::pin(persistence::observe(context, steps))
        })
        .await
        .map_err(|e| MigrationError::History(Box::new(e)))?;
    for step in &steps[applied..] {
        session
            .transaction_named(step.name, move |context| {
                Box::pin(async move {
                    (step.run)(context).await?;
                    persistence::record(context, step).await
                })
            })
            .await
            .map_err(|e| MigrationError::Step {
                id: step.id,
                name: step.name,
                source: Box::new(e),
            })?;
    }
    Ok(())
}
