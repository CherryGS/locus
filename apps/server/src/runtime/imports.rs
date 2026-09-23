use super::{registry::Shared, submissions::Arguments};
use crate::api::task::dto::AccessContext;
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
        // Use the admission lock through collection: reservation and launch are
        // one boundary, so a rejected launch cannot leak a provisional batch.
        let registry = self.lock();
        let admission = if registry.open {
            crate::api::dto::AdmissionState::Open
        } else {
            crate::api::dto::AdmissionState::Draining
        };
        let batches = self.imports.snapshots();
        drop(registry);
        ImportSnapshot {
            admission,
            run_id: self.run_id.clone(),
            batches: batches.into_iter().map(mapping::batch).collect(),
        }
    }
    pub fn import_batch(
        self: &Arc<Self>,
        request: BatchImportRequest,
    ) -> Result<Receipt, ApiError> {
        let domain = self.business()?.clone();
        let state = self.clone();
        let id = uuid::Uuid::now_v7().to_string();
        self.public_claimed(
            crate::runtime::submissions::Admission {
                context: AccessContext::Desktop,
                authorization: None,
                batch: Some(id.clone()),
            },
            request.request_id.clone(),
            Arguments::ImportBatch(request),
            "Import local files",
            None,
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
                        .execute(&domain, &task, &id, &item, Action::Original)
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
        self.recover_import_in(AccessContext::Desktop, None, request)
    }
    pub fn recover_import_in(
        self: &Arc<Self>,
        context: AccessContext,
        authorization: Option<super::external::Authorization>,
        request: ImportRecoveryRequest,
    ) -> Result<Receipt, ApiError> {
        if !self.imports.belongs_to(&request.batch_id, context) {
            return Err(ApiError::invalid(
                "Unknown import batch in this access context",
            ));
        }
        let domain = self.business()?.clone();
        let state = self.clone();
        let operation = request.clone();
        self.public_claimed(
            crate::runtime::submissions::Admission {
                context,
                authorization,
                batch: None,
            },
            request.request_id.clone(),
            Arguments::RecoverImport(request),
            "Recover imported content",
            None,
            move |task| async move {
                state
                    .imports
                    .execute(
                        &domain,
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
