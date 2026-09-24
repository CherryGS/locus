use super::{model::*, store::ImportStore};
use crate::runtime::composition::Domain;
use locus_core::api::Membership;
use locus_file::api::{CurrentInput, FileService, observe_input_in};
use locus_media::api::{
    ApplyOutcome, ExpectedInput, MediaError, MediaService, Recognition, Rendition,
};
use locus_store::api::{Session, StoreError};
use locus_task::api::TaskContext;
use std::sync::{Arc, Mutex};

pub(super) fn uncertain(error: &anyhow::Error) -> bool {
    fn store(e: &StoreError) -> bool {
        matches!(
            e,
            StoreError::CommitOutcomeUnknown(_) | StoreError::RollbackFailed { .. }
        )
    }
    fn core(e: &locus_core::api::CoreError) -> bool {
        matches!(e, locus_core::api::CoreError::Store(e) if store(e))
    }
    fn file(e: &locus_file::api::FileError) -> bool {
        match e {
            locus_file::api::FileError::Store(e) => store(e),
            locus_file::api::FileError::Core(e) => core(e),
            _ => false,
        }
    }
    fn media(e: &MediaError) -> bool {
        match e {
            MediaError::Store(e) => store(e),
            MediaError::Core(e) => core(e),
            MediaError::File(e) => file(e),
            _ => false,
        }
    }
    fn model(e: &locus_model::api::ModelError) -> bool {
        match e {
            locus_model::api::ModelError::Store(e) => store(e),
            locus_model::api::ModelError::Core(e) => core(e),
            locus_model::api::ModelError::File(e) => file(e),
            _ => false,
        }
    }
    fn twitter(e: &locus_twitter::api::TwitterError) -> bool {
        match e {
            locus_twitter::api::TwitterError::Store(e) => store(e),
            locus_twitter::api::TwitterError::Core(e) => core(e),
            locus_twitter::api::TwitterError::File(e) => file(e),
            _ => false,
        }
    }
    error.chain().any(|e| {
        e.downcast_ref::<StoreError>().is_some_and(store)
            || e.downcast_ref::<locus_core::api::CoreError>()
                .is_some_and(core)
            || e.downcast_ref::<locus_file::api::FileError>()
                .is_some_and(file)
            || e.downcast_ref::<MediaError>().is_some_and(media)
            || e.downcast_ref::<locus_model::api::ModelError>()
                .is_some_and(model)
            || e.downcast_ref::<locus_twitter::api::TwitterError>()
                .is_some_and(twitter)
    })
}
pub(super) fn failed(error: anyhow::Error) -> Step {
    Step::error(
        if uncertain(&error) {
            State::Uncertain
        } else if error.chain().any(|e| {
            matches!(
                e.downcast_ref::<MediaError>(),
                Some(MediaError::ContextChanged | MediaError::NewerAttempt)
            ) || matches!(
                e.downcast_ref::<locus_model::api::ModelError>(),
                Some(
                    locus_model::api::ModelError::ContextChanged
                        | locus_model::api::ModelError::NewerAttempt
                        | locus_model::api::ModelError::Core(
                            locus_core::api::CoreError::SlotOccupied(_)
                        )
                )
            )
        }) {
            State::Conflict
        } else {
            State::Failed
        },
        error,
    )
}
pub(super) fn candidate<T: Copy>(cell: &Mutex<Option<T>>) -> Option<T> {
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
            item.current
                .observation_problem
                .get_or_insert_with(|| error.to_string());
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
        if !item.supplied && !item.current.registration.success() {
            self.admit_local(d, task, &mut session, batch, item, action)
                .await;
            if !item.current.registration.success() {
                return Ok(());
            }
        }
        self.establish(d, &mut session, batch, item).await;
        if !item.current.file_attachment.success() {
            return Ok(());
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
                    #[cfg(test)]
                    let force_image = std::mem::take(&mut *self.force_image_match.lock().unwrap());
                    for (kind, observed) in item
                        .current
                        .kinds
                        .iter_mut()
                        .zip([found.image, found.video])
                    {
                        if matches!(kind.recognition.state, State::Success | State::NoMatch) {
                            continue;
                        }
                        #[cfg(test)]
                        let observed =
                            if force_image && kind.kind == locus_media::api::MediaKind::Image {
                                Recognition::Match
                            } else {
                                observed
                            };
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
        self.process_model(d, &mut session, batch, item, entity, file)
            .await;
        // Positive recognition selects provider work even when Model establishment
        // or inspection returned early with an independent failure.
        self.process_civitai(d, &mut session, batch, item, entity, file)
            .await;
        for index in 0..item.current.kinds.len() {
            if !item.current.kinds[index].recognition.success()
                || item.current.kinds[index].complete()
            {
                continue;
            }
            self.process_kind(d, &mut session, batch, item, index, expected)
                .await;
        }
        self.validate_completed_dependencies(d, &mut session, item)
            .await?;
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
        self.confirm_content(d, session, item).await?;
        let (Some(entity), Some(file)) = (item.current.entity, item.current.file) else {
            return Ok(());
        };
        if !item.current.file_attachment.success() || item.current.observation_problem.is_some() {
            return Ok(());
        }
        self.confirm_model(d, session, item).await;
        if let Some(work) = &mut item.current.civitai {
            let before = work.effect();
            d.civitai.confirm(&d.kernel, &d.files, session, work).await;
            item.current.effect += work.effect() - before;
        }
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

#[cfg(test)]
#[test]
fn model_nested_uncertainty_is_never_definite_failure() {
    use locus_model::api::ModelError;
    use locus_store::api::StoreError;
    let uncertain = || StoreError::CommitOutcomeUnknown(diesel::result::Error::RollbackTransaction);
    for error in [
        ModelError::Store(uncertain()),
        ModelError::Core(locus_core::api::CoreError::Store(uncertain())),
        ModelError::File(locus_file::api::FileError::Store(uncertain())),
        ModelError::File(locus_file::api::FileError::Core(
            locus_core::api::CoreError::Store(uncertain()),
        )),
    ] {
        let step = failed(error.into());
        assert_eq!(step.state, crate::imports::State::Uncertain);
    }
}
