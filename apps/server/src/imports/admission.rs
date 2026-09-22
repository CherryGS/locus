use super::{model::*, store::ImportStore, workflow::failed};
use crate::runtime::composition::Domain;
use locus_store::api::Session;
use locus_task::api::TaskContext;
impl ImportStore {
    pub(super) async fn admit_local(
        &self,
        d: &Domain,
        task: &TaskContext,
        session: &mut Session,
        batch: &str,
        item: &mut Item,
        action: Action,
    ) {
        if action == Action::Recopy {
            let effect = item.current.effect;
            item.current = ResultState::new();
            item.current.effect = effect;
            item.prepared = None;
        }
        if item.prepared.is_none() {
            item.current.copy = Step::new(State::Running);
            self.publish(batch, item);
            match d.files.prepare_task(task, &item.source).await {
                Ok(prepared) => {
                    item.current.file = Some(prepared.id());
                    item.current.progress = Some(prepared.progress().clone());
                    item.current.copy = Step::new(State::Success);
                    item.prepared = Some(prepared);
                }
                Err(error) => {
                    item.current.file = Some(error.progress.id);
                    item.current.progress = Some(*error.progress);
                    item.current.copy = Step::error(State::Failed, error.source);
                    item.current.registration = Step::error(
                        State::Failed,
                        "Copy did not complete; explicit recopy reads the source again and may import changed bytes",
                    );
                    item.current.base = item.current.registration.clone();
                    return;
                }
            }
        }
        let Some(prepared) = item.prepared.clone() else {
            return;
        };
        item.current.registration = Step::new(State::Running);
        self.publish(batch, item);
        let files = d.files.clone();
        let kernel = d.kernel.clone();
        #[cfg(test)]
        let fault = self.registration_fault.lock().unwrap().take();
        let result = session
            .transaction_named("Register standalone import File", move |c| {
                Box::pin(async move {
                    let record = files.register_in(&kernel, c, &prepared).await?;
                    #[cfg(test)]
                    if matches!(fault, Some(super::store::BaseFault::Rollback)) {
                        anyhow::bail!("test: registration rollback");
                    }
                    Ok::<_, anyhow::Error>(record)
                })
            })
            .await;
        #[cfg(test)]
        let result = if result.is_ok() && matches!(fault, Some(super::store::BaseFault::Unknown)) {
            Err(locus_store::api::StoreError::CommitOutcomeUnknown(
                diesel::result::Error::RollbackTransaction,
            )
            .into())
        } else {
            result
        };
        match result {
            Ok(_) => {
                item.current.registration = Step::new(State::Success);
                item.current.effect += 1;
            }
            Err(error) => {
                if error.chain().any(|e| {
                    matches!(
                        e.downcast_ref::<locus_file::api::FileError>(),
                        Some(
                            locus_file::api::FileError::PreparedCopyChanged(_)
                                | locus_file::api::FileError::Access { .. }
                        )
                    )
                }) {
                    item.prepared = None;
                    item.current.copy = Step::error(
                        State::Failed,
                        "Completed preparation is unusable; explicit recopy reads potentially changed external bytes",
                    );
                }
                item.current.registration = failed(error);
                item.current.base =
                    Step::error(State::Failed, "File registration is not confirmed");
            }
        }
        self.publish(batch, item);
    }
}
