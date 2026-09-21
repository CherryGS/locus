use super::{registry::Shared, submissions::Arguments};
use crate::{
    api::{
        dto::{Receipt, TaskOutcome},
        error::ApiError,
        imports::{dto::*, mapping},
    },
    imports::Action,
};
use std::sync::Arc;
impl Shared {
    pub fn import_snapshot(&self) -> ImportSnapshot {
        ImportSnapshot {
            admission: self.status().admission,
            run_id: self.run_id.clone(),
            batches: self
                .imports
                .snapshots()
                .into_iter()
                .map(mapping::batch)
                .collect(),
        }
    }
    pub fn import_batch(
        self: &Arc<Self>,
        request: BatchImportRequest,
    ) -> Result<Receipt, ApiError> {
        let state = self.clone();
        let id = request.request_id.clone();
        self.public(
            id.clone(),
            Arguments::ImportBatch(request),
            "Import local files",
            move |task| async move {
                let ids: Vec<_> = state
                    .imports
                    .snapshots()
                    .into_iter()
                    .find(|b| b.id == id)
                    .map(|b| b.items.into_iter().map(|i| i.id).collect())
                    .unwrap_or_default();
                for item in ids {
                    state
                        .imports
                        .execute(&state.domain, &task, &id, &item, Action::Original)
                        .await;
                }
                state.imports.finish_batch(&id);
                TaskOutcome::ImportBatch { batch_id: id }
            },
        )
    }
    pub fn recover_import(
        self: &Arc<Self>,
        request: ImportRecoveryRequest,
    ) -> Result<Receipt, ApiError> {
        let state = self.clone();
        let operation = request.clone();
        self.public(
            request.request_id.clone(),
            Arguments::RecoverImport(request),
            "Recover imported file",
            move |task| async move {
                state
                    .imports
                    .execute(
                        &state.domain,
                        &task,
                        &operation.batch_id,
                        &operation.item_id,
                        mapping::action(operation.action),
                    )
                    .await;
                TaskOutcome::ImportRecovery {
                    batch_id: operation.batch_id,
                    item_id: operation.item_id,
                }
            },
        )
    }
}
