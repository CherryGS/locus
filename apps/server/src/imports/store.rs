use super::model::*;
use crate::api::task::dto::AccessContext;
use std::{
    collections::BTreeMap,
    sync::{Mutex, MutexGuard},
};
#[cfg(test)]
#[derive(Clone, Copy)]
pub(crate) enum BaseFault {
    Rollback,
    Unknown,
}

#[cfg(test)]
type PauseSource = (
    String,
    std::sync::Arc<tokio::sync::Notify>,
    std::sync::Arc<tokio::sync::Notify>,
);

#[cfg(test)]
type PauseContent = (
    std::sync::Arc<tokio::sync::Notify>,
    std::sync::Arc<tokio::sync::Notify>,
);

#[derive(Default)]
pub(crate) struct ImportStore {
    batches: Mutex<BTreeMap<String, Batch>>,
    #[cfg(test)]
    pub base_fault: Mutex<Option<BaseFault>>,
    #[cfg(test)]
    pub registration_fault: Mutex<Option<BaseFault>>,
    #[cfg(test)]
    pub source_fault: Mutex<Option<BaseFault>>,
    #[cfg(test)]
    pub association_fault: Mutex<Option<BaseFault>>,
    #[cfg(test)]
    pub fail_session: Mutex<bool>,
    #[cfg(test)]
    pub unknown_interpretation: Mutex<bool>,
    #[cfg(test)]
    pub model_establishment_fault: Mutex<Option<BaseFault>>,
    #[cfg(test)]
    pub unknown_model_inspection: Mutex<bool>,
    #[cfg(test)]
    pub fail_preview: Mutex<bool>,
    #[cfg(test)]
    pub force_image_match: Mutex<bool>,
    #[cfg(test)]
    pub pause_source: Mutex<Option<PauseSource>>,
    #[cfg(test)]
    pub pause_content: Mutex<Option<PauseContent>>,
}
impl ImportStore {
    pub fn lock(&self) -> MutexGuard<'_, BTreeMap<String, Batch>> {
        self.batches.lock().unwrap_or_else(|e| e.into_inner())
    }
    pub fn snapshots(&self) -> Vec<Batch> {
        self.lock().values().cloned().collect()
    }
    pub fn belongs_to(&self, id: &str, context: AccessContext) -> bool {
        self.lock()
            .get(id)
            .is_some_and(|batch| batch.access_context == context)
    }
    pub fn reserve_batch(&self, id: &str, request: &str, context: AccessContext, paths: &[String]) {
        self.lock().insert(
            id.into(),
            Batch {
                access_context: context,
                original_request_id: request.into(),
                id: id.into(),
                ended: false,
                items: paths
                    .iter()
                    .map(|source| {
                        let current = ResultState::new();
                        Item {
                            id: uuid::Uuid::now_v7().to_string(),
                            source: source.clone(),
                            supplied: false,
                            snapshot: None,
                            current: current.clone(),
                            attempts: vec![Attempt {
                                id: request.into(),
                                action: Action::Original,
                                ended: false,
                                result: current,
                            }],
                            active: Some(request.into()),
                            prepared: None,
                        }
                    })
                    .collect(),
            },
        );
    }
    pub fn reserve_registered(
        &self,
        id: &str,
        request: &str,
        context: AccessContext,
        inputs: Vec<(
            Option<locus_file::api::FileId>,
            Option<locus_twitter::api::TwitterSnapshot>,
        )>,
    ) {
        let items = inputs
            .into_iter()
            .map(|(file, snapshot)| {
                let mut current = ResultState::new();
                current.copy = Step::new(State::NotRequested);
                current.file = file;
                current.registration = if file.is_some() {
                    Step::error(
                        State::Success,
                        "Previously registered input; not created by this attempt",
                    )
                } else {
                    Step::new(State::NotRequested)
                };
                if file.is_none() {
                    current.file_attachment = Step::new(State::NotRequested);
                    current.kinds.clear();
                    current.model.recognition = Step::new(State::NotRequested);
                    current.model.establishment = Step::new(State::NotRequested);
                    current.model.inspection = Step::new(State::NotRequested);
                }
                if snapshot.is_some() {
                    current.twitter = Step::new(State::Pending);
                    if file.is_some() {
                        current.association = Step::new(State::Pending);
                    }
                }
                Item {
                    id: uuid::Uuid::now_v7().to_string(),
                    source: String::new(),
                    supplied: true,
                    snapshot,
                    current: current.clone(),
                    attempts: vec![Attempt {
                        id: request.into(),
                        action: Action::Original,
                        ended: false,
                        result: current,
                    }],
                    active: Some(request.into()),
                    prepared: None,
                }
            })
            .collect();
        self.lock().insert(
            id.into(),
            Batch {
                access_context: context,
                original_request_id: request.into(),
                id: id.into(),
                items,
                ended: false,
            },
        );
    }
    pub fn reserve_recovery(
        &self,
        batch: &str,
        item: &str,
        request: &str,
        action: Action,
    ) -> Result<(), String> {
        let mut all = self.lock();
        let item = all
            .get_mut(batch)
            .and_then(|b| b.items.iter_mut().find(|i| i.id == item))
            .ok_or("Unknown import item in this run")?;
        if item.active.is_some() {
            return Err("This item already has active work".into());
        }
        if action != Action::Confirm && item.current.uncertain() {
            return Err("Confirm the original outcome before creating more work".into());
        }
        if action == Action::Recopy
            && (item.supplied
                || item.current.registration.success()
                || item.current.registration.state == State::Uncertain
                || item.current.base.state != State::Failed)
        {
            return Err("Recopy requires definite base non-admission".into());
        }
        if action == Action::Retry
            && (item.current.complete()
                || (!item.supplied
                    && !item.current.registration.success()
                    && item.prepared.is_none()))
        {
            return Err("No eligible unfinished work or retained preparation; use explicit recopy where available".into());
        }
        item.active = Some(request.into());
        item.attempts.push(Attempt {
            id: request.into(),
            action,
            ended: false,
            result: item.current.clone(),
        });
        Ok(())
    }
    pub fn release(&self, batch: &str, item: Option<&str>, request: &str) {
        let mut all = self.lock();
        if let Some(id) = item {
            if let Some(item) = all
                .get_mut(batch)
                .and_then(|b| b.items.iter_mut().find(|i| i.id == id))
                && item.active.as_deref() == Some(request)
            {
                item.active = None;
                item.attempts.retain(|a| a.id != request);
            }
        } else {
            all.remove(batch);
        }
    }
    pub fn item(&self, batch: &str, id: &str) -> Option<Item> {
        self.lock()
            .get(batch)?
            .items
            .iter()
            .find(|i| i.id == id)
            .cloned()
    }
    pub fn publish(&self, batch: &str, item: &Item) {
        if let Some(target) = self
            .lock()
            .get_mut(batch)
            .and_then(|b| b.items.iter_mut().find(|i| i.id == item.id))
        {
            *target = item.clone();
        }
    }
    pub fn finish(&self, batch: &str, mut item: Item) {
        if let Some(id) = item.active.take()
            && let Some(attempt) = item.attempts.iter_mut().find(|a| a.id == id)
        {
            attempt.ended = true;
            attempt.result = item.current.clone();
        }
        self.publish(batch, &item);
    }
    pub fn end_unfinished(&self, context: AccessContext, request: &str) {
        let mut all = self.lock();
        for batch in all.values_mut().filter(|b| b.access_context == context) {
            for item in &mut batch.items {
                if item.active.as_deref() != Some(request) {
                    continue;
                }
                item.active = None;
                if item.current.copy.state == State::Running {
                    item.current.copy = Step::error(
                        State::Failed,
                        "Execution ended without completed preparation; managed effects may remain",
                    );
                }
                if item.current.base.state == State::Running {
                    item.current.base = Step::error(
                        State::Uncertain,
                        "Execution ended without an attributable commit outcome",
                    );
                } else if matches!(item.current.base.state, State::Pending) {
                    item.current.base =
                        Step::error(State::Failed, "Execution ended before database admission");
                }
                for step in [
                    &mut item.current.registration,
                    &mut item.current.file_attachment,
                    &mut item.current.twitter,
                    &mut item.current.association,
                ] {
                    if step.state == State::Running {
                        *step = Step::error(
                            State::Uncertain,
                            "Execution ended without an attributable commit outcome",
                        );
                    }
                }
                for kind in &mut item.current.kinds {
                    for step in [&mut kind.establishment, &mut kind.interpretation] {
                        if step.state == State::Running {
                            *step = Step::error(
                                State::Uncertain,
                                "Execution ended without an attributable write outcome",
                            );
                        }
                    }
                    for step in [&mut kind.recognition, &mut kind.preview] {
                        if step.state == State::Running {
                            *step = Step::error(
                                State::Failed,
                                "Execution ended without a processing result",
                            );
                        }
                    }
                }
                if let Some(attempt) = item.attempts.iter_mut().find(|a| a.id == request) {
                    attempt.ended = true;
                    attempt.result = item.current.clone();
                }
            }
            if batch.original_request_id == request {
                batch.ended = true;
            }
        }
    }
    pub fn finish_batch(&self, batch: &str) {
        if let Some(b) = self.lock().get_mut(batch) {
            b.ended = true;
        }
    }
}
