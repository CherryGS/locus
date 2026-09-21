use super::{model::*, store::ImportStore};
use crate::runtime::composition::Domain;
use locus_core::api::Membership;
use locus_file::api::{CurrentInput, FILE_KIND, FileService, observe_input_in};
use locus_media::api::{
    ApplyOutcome, ExpectedInput, MediaError, MediaService, Recognition, Rendition,
};
use locus_store::api::{Session, StoreError};
use locus_task::api::TaskContext;
use std::sync::{Arc, Mutex};

fn uncertain(error: &anyhow::Error) -> bool {
    fn store(error: &StoreError) -> bool {
        matches!(
            error,
            StoreError::CommitOutcomeUnknown(_) | StoreError::RollbackFailed { .. }
        )
    }
    error.chain().any(|error| {
        error.downcast_ref::<StoreError>().is_some_and(store)
        || matches!(error.downcast_ref::<MediaError>(), Some(MediaError::Store(e)) if store(e))
        || matches!(error.downcast_ref::<locus_file::api::FileError>(), Some(locus_file::api::FileError::Store(e)) if store(e))
        || matches!(error.downcast_ref::<locus_core::api::CoreError>(), Some(locus_core::api::CoreError::Store(e)) if store(e))
    })
}
fn failed(error: anyhow::Error) -> Step {
    Step::error(
        if uncertain(&error) {
            State::Uncertain
        } else if error.chain().any(|e| {
            matches!(
                e.downcast_ref::<MediaError>(),
                Some(MediaError::ContextChanged | MediaError::NewerAttempt)
            )
        }) {
            State::Conflict
        } else {
            State::Failed
        },
        error,
    )
}
fn candidate<T: Copy>(cell: &Mutex<Option<T>>) -> Option<T> {
    *cell.lock().unwrap_or_else(|e| e.into_inner())
}

impl ImportStore {
    pub async fn execute(
        &self,
        domain: &Domain,
        task: &TaskContext,
        batch: &str,
        id: &str,
        action: Action,
    ) {
        let Some(mut item) = self.item(batch, id) else {
            return;
        };
        #[cfg(test)]
        {
            let pause = {
                let mut slot = self.pause_source.lock().unwrap();
                if slot
                    .as_ref()
                    .is_some_and(|(source, _, _)| *source == item.source)
                {
                    slot.take()
                } else {
                    None
                }
            };
            if let Some((_, entered, release)) = pause {
                entered.notify_one();
                release.notified().await;
            }
        }
        item.current.observation_problem = None;
        let result = self.run(domain, task, batch, &mut item, action).await;
        if let Err(error) = result {
            item.current.observation_problem = Some(error.to_string());
            if !item.current.base.success() && item.current.base.state != State::Uncertain {
                item.current.base = failed(error);
            }
        }
        self.finish(batch, item);
    }
    async fn run(
        &self,
        d: &Domain,
        task: &TaskContext,
        batch: &str,
        item: &mut Item,
        action: Action,
    ) -> anyhow::Result<()> {
        #[cfg(test)]
        if std::mem::take(&mut *self.fail_session.lock().unwrap()) {
            anyhow::bail!("test: session unavailable");
        }
        let mut session = d.database.session(task).await?;
        if action == Action::Confirm {
            return self.confirm(d, &mut session, item).await;
        }
        if !item.current.base.success() {
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
                        item.current.copy = Step::error(State::Failed, &error.source);
                        item.current.base = Step::error(
                            State::Failed,
                            "Copy did not complete; explicit recopy reads the source again and may import changed bytes",
                        );
                        return Ok(());
                    }
                }
            }
            item.current.base = Step::new(State::Running);
            self.publish(batch, item);
            let Some(prepared) = item.prepared.clone() else {
                return Ok(());
            };
            let candidate_entity = Arc::new(Mutex::new(None));
            let cell = candidate_entity.clone();
            let files = d.files.clone();
            let kernel = d.kernel.clone();
            #[cfg(test)]
            let fault = self.base_fault.lock().unwrap().take();
            let committed = session
                .transaction_named("Import File and Entity", move |c| {
                    Box::pin(async move {
                        let file = files.register_in(&kernel, c, &prepared).await?;
                        let entity = kernel.create_entity_in(c).await?;
                        *cell.lock().unwrap_or_else(|e| e.into_inner()) = Some(entity);
                        kernel
                            .attach_in(
                                c,
                                Membership {
                                    entity,
                                    kind: FILE_KIND,
                                    component: file.id.component(),
                                },
                            )
                            .await?;
                        #[cfg(test)]
                        if matches!(fault, Some(super::store::BaseFault::Rollback)) {
                            anyhow::bail!("test: reject combined unit after all participants");
                        }
                        Ok::<_, anyhow::Error>(entity)
                    })
                })
                .await;
            #[cfg(test)]
            let committed =
                if committed.is_ok() && matches!(fault, Some(super::store::BaseFault::Unknown)) {
                    Err(anyhow::Error::from(StoreError::CommitOutcomeUnknown(
                        diesel::result::Error::RollbackTransaction,
                    )))
                } else {
                    committed
                };
            item.current.entity = candidate(&candidate_entity);
            match committed {
                Ok(entity) => {
                    item.current.entity = Some(entity);
                    item.current.base = Step::new(State::Success);
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
                            "Completed preparation is no longer reusable; explicit recopy reads source bytes again and they may have changed",
                        );
                    }
                    item.current.base = failed(error);
                    return Ok(());
                }
            }
            self.publish(batch, item);
        }
        let (Some(entity), Some(file)) = (item.current.entity, item.current.file) else {
            return Ok(());
        };
        let expected = ExpectedInput {
            entity,
            file,
            revision: None,
        };
        // Revalidate the exact original target before every creating stage. Media
        // additionally validates that target in its actual capture transaction.
        if let Err(error) = guard(d, &mut session, expected).await {
            item.current.observation_problem =
                Some(format!("Original import context cannot be used: {error}"));
            return Ok(());
        }
        if item
            .current
            .kinds
            .iter()
            .any(|k| !matches!(k.recognition.state, State::Success | State::NoMatch))
        {
            for k in &mut item.current.kinds {
                if !matches!(k.recognition.state, State::Success | State::NoMatch) {
                    k.recognition = Step::new(State::Running);
                }
            }
            self.publish(batch, item);
            match d.media.recognize(&d.files, &mut session, file).await {
                Ok(found) => {
                    for (kind, observed) in item
                        .current
                        .kinds
                        .iter_mut()
                        .zip([found.image, found.video])
                    {
                        if matches!(kind.recognition.state, State::Success | State::NoMatch) {
                            continue;
                        }
                        kind.recognition = match observed {
                            Recognition::Match => Step::new(State::Success),
                            Recognition::NoMatch => Step::new(State::NoMatch),
                            Recognition::Failed(e) => Step::error(State::Failed, e),
                        };
                        if kind.recognition.state != State::Success {
                            kind.establishment =
                                Step::error(State::Skipped, "Recognition did not match");
                            kind.interpretation = kind.establishment.clone();
                            kind.preview = kind.establishment.clone();
                        }
                    }
                }
                Err(e) => {
                    for kind in &mut item.current.kinds {
                        if kind.recognition.state == State::Running {
                            kind.recognition = Step::error(State::Failed, &e);
                        }
                    }
                }
            }
            self.publish(batch, item);
        }
        for index in 0..item.current.kinds.len() {
            if !item.current.kinds[index].recognition.success()
                || item.current.kinds[index].complete()
            {
                continue;
            }
            self.process_kind(d, &mut session, batch, item, index, expected)
                .await;
        }
        Ok(())
    }
    async fn process_kind(
        &self,
        d: &Domain,
        session: &mut Session,
        batch: &str,
        item: &mut Item,
        index: usize,
        expected: ExpectedInput,
    ) {
        if !item.current.kinds[index].establishment.success() {
            if item.current.kinds[index].component.is_some() {
                item.current.kinds[index].establishment = Step::error(
                    State::Conflict,
                    "Original component establishment is unresolved; confirm the original result",
                );
                return;
            }
            item.current.kinds[index].establishment = Step::new(State::Running);
            self.publish(batch, item);
            let kind = item.current.kinds[index].kind;
            let kernel = d.kernel.clone();
            let cell = Arc::new(Mutex::new(None));
            let captured = cell.clone();
            let result = session
                .transaction_named("Import Media component and attachment", move |c| {
                    Box::pin(async move {
                        if observe_input_in(&kernel, c, expected.entity).await?
                            != CurrentInput::File(expected.file)
                        {
                            return Err(MediaError::ContextChanged);
                        }
                        let id = MediaService::create_in(&kernel, c, kind).await?;
                        *captured.lock().unwrap_or_else(|e| e.into_inner()) = Some(id);
                        kernel
                            .attach_in(
                                c,
                                Membership {
                                    entity: expected.entity,
                                    kind: kind.kind(),
                                    component: id.component(),
                                },
                            )
                            .await?;
                        Ok(id)
                    })
                })
                .await;
            match result {
                Ok(id) => {
                    item.current.kinds[index].component = Some(id);
                    item.current.kinds[index].revision = Some(0);
                    item.current.kinds[index].establishment = Step::new(State::Success);
                    item.current.effect += 1;
                }
                Err(error) => {
                    let step = failed(error.into());
                    if step.state == State::Uncertain {
                        item.current.kinds[index].component = candidate(&cell);
                    }
                    item.current.kinds[index].establishment = step;
                    self.publish(batch, item);
                    return;
                }
            }
            self.publish(batch, item);
        }
        let Some(id) = item.current.kinds[index].component else {
            return;
        };
        let mut expected = expected;
        expected.revision = item.current.kinds[index].revision;
        if item.current.kinds[index].interpretation.success() {
            // Preview-only retry may keep a successful interpretation only while
            // its actual revision and original input remain applicable.
            match d.media.view(&d.kernel, session, id).await {
                Ok(view)
                    if view.record.revision == item.current.kinds[index].revision.unwrap_or(-1)
                        && view.record.basis == Some(expected.file)
                        && view.record.last_failure.is_none()
                        && matches!(view.applicability, locus_media::api::Applicability::Input(locus_file::api::InputComparison::Matching(f)) if f == expected.file) =>
                    {}
                Ok(_) => {
                    item.current.kinds[index].preview = Step::error(
                        State::Conflict,
                        "The successful interpretation or original context changed",
                    );
                    return;
                }
                Err(e) => {
                    item.current.kinds[index].preview = Step::error(State::Failed, e);
                    return;
                }
            }
        } else {
            item.current.kinds[index].interpretation = Step::new(State::Running);
            self.publish(batch, item);
            let result = async {
                let prepared = d
                    .media
                    .prepare_expected(&d.kernel, &d.files, session, id, Some(expected))
                    .await?;
                d.media.apply(&d.kernel, session, prepared).await
            }
            .await;
            #[cfg(test)]
            let result = if matches!(result, Ok(ApplyOutcome::Accepted(_)))
                && std::mem::take(&mut *self.unknown_interpretation.lock().unwrap())
            {
                Err(MediaError::Store(StoreError::CommitOutcomeUnknown(
                    diesel::result::Error::RollbackTransaction,
                )))
            } else {
                result
            };
            match result {
                Ok(ApplyOutcome::Accepted(record)) => {
                    item.current.kinds[index].revision = Some(record.revision);
                    item.current.effect += 1;
                    item.current.kinds[index].interpretation = match record.last_failure {
                        Some(f) => Step::error(State::Failed, f),
                        None => Step::new(State::Success),
                    };
                }
                Ok(other) => {
                    item.current.kinds[index].interpretation =
                        Step::error(State::Conflict, format!("{other:?}"))
                }
                Err(e) => item.current.kinds[index].interpretation = failed(e.into()),
            }
            self.publish(batch, item);
            if !item.current.kinds[index].interpretation.success() {
                item.current.kinds[index].preview = Step::error(
                    State::Skipped,
                    "Requires accepted successful interpretation",
                );
                return;
            }
        }
        expected.revision = item.current.kinds[index].revision;
        item.current.kinds[index].preview = Step::new(State::Running);
        self.publish(batch, item);
        #[cfg(test)]
        if std::mem::take(&mut *self.fail_preview.lock().unwrap()) {
            item.current.kinds[index].preview = Step::error(State::Failed, "test: preview failed");
            return;
        }
        match d
            .media
            .preview_expected(
                &d.kernel,
                &d.files,
                session,
                id,
                Rendition { edge: 320 },
                Some(expected),
            )
            .await
        {
            Ok(output) => {
                item.current.kinds[index].output = Some(Arc::new(output));
                item.current.kinds[index].locator = Some(uuid::Uuid::now_v7().to_string());
                item.current.kinds[index].preview = Step::new(State::Success);
                item.current.effect += 1;
            }
            Err(e) => item.current.kinds[index].preview = failed(e.into()),
        }
        self.publish(batch, item);
    }
    async fn confirm(
        &self,
        d: &Domain,
        session: &mut Session,
        item: &mut Item,
    ) -> anyhow::Result<()> {
        // Positive coherent evidence can confirm a candidate. Absence never proves
        // historical rollback: removed effects must not be silently recreated.
        let (Some(entity), Some(file)) = (item.current.entity, item.current.file) else {
            return Ok(());
        };
        let kernel = d.kernel.clone();
        let kinds = item.current.kinds.clone();
        let evidence = session
            .transaction_named("Confirm original import effects", move |c| {
                Box::pin(async move {
                    if observe_input_in(&kernel, c, entity).await? != CurrentInput::File(file) {
                        return Err(MediaError::ContextChanged);
                    }
                    FileService::read_in(c, file).await?;
                    let members = kernel.memberships_in(c, entity).await?;
                    let mut confirmed = Vec::new();
                    for kind in kinds {
                        if let Some(id) = kind.component
                            && members.iter().any(|m| {
                                m.component == id.component() && m.kind == id.kind().kind()
                            })
                        {
                            confirmed.push(MediaService::read_in(c, id).await?);
                        }
                    }
                    Ok(confirmed)
                })
            })
            .await;
        match evidence {
            Ok(ids) => {
                if item.current.base.state == State::Uncertain {
                    item.current.base = Step::new(State::Success);
                    item.current.effect += 1;
                }
                for kind in &mut item.current.kinds {
                    if kind.establishment.state == State::Uncertain
                        && kind
                            .component
                            .is_some_and(|id| ids.iter().any(|record| record.id == id))
                    {
                        kind.establishment = Step::new(State::Success);
                        kind.revision = ids
                            .iter()
                            .find(|record| Some(record.id) == kind.component)
                            .map(|record| record.revision);
                        item.current.effect += 1;
                    }
                    if kind.interpretation.state == State::Uncertain
                        && let Some(record) =
                            ids.iter().find(|record| Some(record.id) == kind.component)
                        && record.revision > kind.revision.unwrap_or(-1)
                    {
                        if record.basis == Some(file)
                            && record.facts.is_some()
                            && record.last_failure.is_none()
                        {
                            kind.interpretation = Step::error(
                                State::Success,
                                "Current applicable successful interpretation observed; the original attempt's acceptance remains unconfirmed",
                            );
                            kind.revision = Some(record.revision);
                            item.current.effect += 1;
                        } else if let Some(failure) = &record.last_failure {
                            kind.interpretation = Step::error(
                                State::Failed,
                                format!(
                                    "Current interpretation warning observed: {failure}; the original attempt remains unconfirmed"
                                ),
                            );
                            kind.revision = Some(record.revision);
                            item.current.effect += 1;
                        }
                    }
                }
            }
            Err(error) => {
                item.current.observation_problem = Some(format!(
                    "Original result observation failed: {error}. Present absence is not proof of rollback."
                ));
            }
        }
        Ok(())
    }
}
async fn guard(d: &Domain, session: &mut Session, expected: ExpectedInput) -> anyhow::Result<()> {
    let kernel = d.kernel.clone();
    session
        .transaction_named("Check original import target", move |c| {
            Box::pin(async move {
                if observe_input_in(&kernel, c, expected.entity).await?
                    != CurrentInput::File(expected.file)
                {
                    return Err(MediaError::ContextChanged.into());
                }
                FileService::read_in(c, expected.file).await?;
                Ok(())
            })
        })
        .await
}
