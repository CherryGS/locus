use super::{
    model::*,
    store::ImportStore,
    workflow::{candidate, failed},
};
use crate::runtime::composition::Domain;
use locus_core::api::{EntityId, Membership};
use locus_file::api::{CurrentInput, FileId, FileService, observe_input_in};
use locus_model::api::{
    ApplyOutcome, ExpectedInput, InputContext, MODEL_KIND, ModelError, ModelService,
    RecognitionOutcome,
};
use locus_store::api::Session;
use std::sync::{Arc, Mutex};
impl ImportStore {
    pub(super) async fn process_model(
        &self,
        d: &Domain,
        s: &mut Session,
        batch: &str,
        item: &mut Item,
        entity: EntityId,
        file: FileId,
    ) {
        if !matches!(
            item.current.model.recognition.state,
            State::Success | State::NoMatch
        ) {
            item.current.model.recognition = Step::new(State::Running);
            self.publish(batch, item);
            let observed = d.model.recognize(&d.files, s, file).await;
            item.current.model.recognition = match observed.outcome {
                RecognitionOutcome::Match => Step::new(State::Success),
                RecognitionOutcome::NoMatch => Step::new(State::NoMatch),
                RecognitionOutcome::Failed(e) => Step::error(State::Failed, e),
            };
            if !item.current.model.recognition.success() {
                item.current.model.establishment = Step::error(
                    State::Skipped,
                    "Requires a confirmed Model recognition match",
                );
                item.current.model.inspection = item.current.model.establishment.clone();
            }
            self.publish(batch, item);
        }
        if !item.current.model.recognition.success() {
            return;
        }
        if item.current.civitai.is_none() {
            item.current.civitai = Some(locus_civitai::api::Enrichment::new(entity, file, true));
            self.publish(batch, item);
        }
        if !item.current.model.establishment.success() {
            if item.current.model.component.is_some() {
                item.current.model.establishment = Step::error(
                    State::Conflict,
                    "Original Model establishment is unresolved; confirm its result",
                );
                return;
            }
            item.current.model.establishment = Step::new(State::Running);
            self.publish(batch, item);
            let k = d.kernel.clone();
            let cell = Arc::new(Mutex::new(None));
            let captured = cell.clone();
            #[cfg(test)]
            let fault = self.model_establishment_fault.lock().unwrap().take();
            let result = s
                .transaction_named("Import Model and attachment", move |c| {
                    Box::pin(async move {
                        if observe_input_in(&k, c, entity).await? != CurrentInput::File(file) {
                            return Err(ModelError::ContextChanged);
                        }
                        FileService::read_in(c, file).await?;
                        let id = ModelService::create_in(&k, c).await?;
                        *captured.lock().unwrap_or_else(|e| e.into_inner()) = Some(id);
                        k.attach_in(
                            c,
                            Membership {
                                entity,
                                kind: MODEL_KIND,
                                component: id.component(),
                            },
                        )
                        .await?;
                        #[cfg(test)]
                        if matches!(fault, Some(super::store::BaseFault::Rollback)) {
                            return Err(ModelError::ContextChanged);
                        }
                        Ok(id)
                    })
                })
                .await;
            #[cfg(test)]
            let result =
                if result.is_ok() && matches!(fault, Some(super::store::BaseFault::Unknown)) {
                    Err(ModelError::Store(
                        locus_store::api::StoreError::CommitOutcomeUnknown(
                            diesel::result::Error::RollbackTransaction,
                        ),
                    ))
                } else {
                    result
                };
            match result {
                Ok(id) => {
                    item.current.model.component = Some(id);
                    item.current.model.revision = Some(0);
                    item.current.model.establishment = Step::new(State::Success);
                    item.current.effect += 1;
                }
                Err(e) => {
                    let step = failed(e.into());
                    if step.state == State::Uncertain {
                        item.current.model.component = candidate(&cell)
                    }
                    item.current.model.establishment = step;
                    item.current.model.inspection =
                        Step::error(State::Skipped, "Requires confirmed Model attachment");
                    self.publish(batch, item);
                    return;
                }
            }
            self.publish(batch, item);
        }
        let Some(id) = item.current.model.component else {
            return;
        };
        // Always reobserve established state on recovery, including a previously
        // successful part. A newer failed attempt cannot hide behind older facts.
        let view = match d.model.view(&d.kernel, s, id).await {
            Ok(v) => v,
            Err(e) => {
                item.current.model.inspection = failed(e.into());
                return;
            }
        };
        if let Err(e) = &view.context {
            item.current.model.inspection = Step::error(
                State::Failed,
                format!("Model context observation failed: {e}"),
            );
            return;
        }
        if let Some(e) = &view.file_problem {
            item.current.model.inspection =
                Step::error(State::Failed, format!("Model File observation failed: {e}"));
            return;
        }
        if view.context.as_ref().ok()
            != Some(&InputContext::Hosted {
                host: entity,
                input: CurrentInput::File(file),
            })
            || view.file_problem.is_some()
        {
            item.current.model.inspection = Step::error(
                State::Conflict,
                "Original Model host/File context is missing or changed",
            );
            return;
        }
        let record = view.record;
        if record.facts.is_some() && record.basis == Some(file) && record.last_failure.is_none() {
            if item.current.model.revision != Some(record.revision)
                || !item.current.model.inspection.success()
            {
                item.current.model.inspection = Step::error(
                    State::Success,
                    "Applicable inspection observed on the original Model; retained existing state",
                );
                item.current.model.revision = Some(record.revision);
                item.current.effect += 1;
                self.publish(batch, item);
            }
            return;
        }
        item.current.model.revision = Some(record.revision);
        item.current.model.inspection = Step::new(State::Running);
        self.publish(batch, item);
        let expected = ExpectedInput {
            entity,
            file,
            revision: Some(record.revision),
        };
        let result = async {
            let prepared = d
                .model
                .prepare_expected(&d.kernel, &d.files, s, id, Some(expected))
                .await?;
            d.model.apply(&d.kernel, s, prepared).await
        }
        .await;
        #[cfg(test)]
        let result = if matches!(result, Ok(ApplyOutcome::Accepted(_)))
            && std::mem::take(&mut *self.unknown_model_inspection.lock().unwrap())
        {
            Err(ModelError::Store(
                locus_store::api::StoreError::CommitOutcomeUnknown(
                    diesel::result::Error::RollbackTransaction,
                ),
            ))
        } else {
            result
        };
        match result {
            Ok(ApplyOutcome::Accepted(r)) => {
                item.current.model.revision = Some(r.revision);
                item.current.model.inspection = match r.last_failure {
                    Some(e) => Step::error(State::Failed, e),
                    None => Step::new(State::Success),
                };
                item.current.effect += 1
            }
            Ok(ApplyOutcome::RejectedContextChanged) => {
                item.current.model.inspection = Step::error(
                    State::Conflict,
                    "Model host or File input changed during inspection",
                )
            }
            Ok(ApplyOutcome::RejectedNewerAttempt) => {
                item.current.model.inspection = Step::error(
                    State::Conflict,
                    "A newer recorded Model inspection superseded this attempt",
                )
            }
            Err(e) => item.current.model.inspection = failed(e.into()),
        }
        self.publish(batch, item);
    }
    pub(super) async fn confirm_model(&self, d: &Domain, s: &mut Session, item: &mut Item) {
        let (Some(id), Some(entity), Some(file)) = (
            item.current.model.component,
            item.current.entity,
            item.current.file,
        ) else {
            return;
        };
        let view = match d.model.view(&d.kernel, s, id).await {
            Ok(v) => v,
            Err(e) => {
                item.current.observation_problem = Some(format!(
                    "Original Model observation failed: {e}; absence does not establish non-commit"
                ));
                return;
            }
        };
        if let Err(e) = &view.context {
            item.current.observation_problem =
                Some(format!("Original Model context observation failed: {e}"));
            return;
        }
        if let Some(e) = &view.file_problem {
            item.current.observation_problem =
                Some(format!("Original Model File observation failed: {e}"));
            return;
        }
        if view.context.as_ref().ok()
            != Some(&InputContext::Hosted {
                host: entity,
                input: CurrentInput::File(file),
            })
            || view.file_problem.is_some()
        {
            item.current.observation_problem = Some(
                "Original Model context cannot be confirmed; no membership repair is permitted"
                    .into(),
            );
            return;
        }
        if item.current.model.establishment.state == State::Uncertain {
            item.current.model.establishment =
                Step::error(State::Success, "Original Model attachment observed");
            item.current.effect += 1;
        }
        let r = view.record;
        if item.current.model.inspection.state == State::Uncertain
            && r.revision <= item.current.model.revision.unwrap_or(-1)
        {
            return;
        }

        if r.facts.is_some() && r.basis == Some(file) && r.last_failure.is_none() {
            item.current.model.inspection = Step::error(
                State::Success,
                "Current applicable successful inspection observed; original commit attribution remains unconfirmed",
            );
            item.current.effect += 1;
        } else if let Some(e) = r.last_failure {
            item.current.model.inspection = Step::error(
                State::Failed,
                format!(
                    "Current inspection failure observed: {e}; original commit attribution remains unconfirmed"
                ),
            );
            item.current.effect += 1;
        }
        item.current.model.revision = Some(r.revision);
    }
}
