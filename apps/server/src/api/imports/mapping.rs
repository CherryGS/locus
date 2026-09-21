use super::dto::*;
use crate::{
    api::media::{dto::PreviewOrigin, mapping as media},
    imports as owner,
};
fn step(s: &owner::Step) -> ImportStep {
    ImportStep {
        reason: s.reason.clone(),
        state: match s.state {
            owner::State::Pending => ImportStepState::Pending,
            owner::State::Running => ImportStepState::Running,
            owner::State::Success => ImportStepState::Success,
            owner::State::NoMatch => ImportStepState::NoMatch,
            owner::State::Failed => ImportStepState::Failed,
            owner::State::Uncertain => ImportStepState::Uncertain,
            owner::State::Conflict => ImportStepState::Conflict,
            owner::State::Skipped => ImportStepState::Skipped,
        },
    }
}
fn result(r: &owner::ResultState) -> ImportResult {
    ImportResult {
        observation_problem: r.observation_problem.clone(),
        copy: step(&r.copy),
        base: step(&r.base),
        entity_id: r.entity.map(|id| id.to_string()),
        file_id: r.file.map(|id| id.to_string()),
        copied_bytes: r.progress.as_ref().map(|p| p.bytes_written.to_string()),
        managed_bytes_may_exist: r
            .progress
            .as_ref()
            .is_some_and(|p| p.managed_bytes_may_exist),
        copy_complete: r.progress.as_ref().is_some_and(|p| p.copy_complete),
        complete: r.complete(),
        effect_revision: r.effect.to_string(),
        kinds: r
            .kinds
            .iter()
            .map(|k| ImportKindResult {
                kind: media::kind(k.kind),
                component_id: k.component.map(|id| id.component().to_string()),
                recognition: step(&k.recognition),
                establishment: step(&k.establishment),
                interpretation: step(&k.interpretation),
                preview: step(&k.preview),
                output: k
                    .output
                    .as_ref()
                    .zip(k.locator.as_ref())
                    .map(|(p, locator)| crate::api::media::dto::PreviewMetadata {
                        locator: locator.clone(),
                        file_id: p.file.to_string(),
                        kind: media::kind(p.kind),
                        edge: p.rendition.edge,
                        stream_index: p.stream_index,
                        origin: match p.origin {
                            locus_media::api::PreviewOrigin::Hit => PreviewOrigin::Hit,
                            locus_media::api::PreviewOrigin::Generated => PreviewOrigin::Generated,
                        },
                    }),
            })
            .collect(),
    }
}
pub(crate) fn batch(b: owner::Batch) -> ImportBatch {
    ImportBatch {
        batch_id: b.id,
        original_ended: b.ended,
        items: b
            .items
            .into_iter()
            .map(|i| {
                let actions = if i.active.is_some() {
                    vec![]
                } else if i.current.uncertain() {
                    vec![ImportAction::Confirm]
                } else if i.current.complete() {
                    vec![]
                } else if i.current.base.success() {
                    vec![ImportAction::Retry, ImportAction::Confirm]
                } else if i.prepared.is_some() {
                    vec![ImportAction::Retry]
                } else if i.current.base.state == owner::State::Failed {
                    vec![ImportAction::Recopy]
                } else {
                    vec![ImportAction::Confirm]
                };
                ImportItem {
                    item_id: i.id,
                    source_path: i.source,
                    active_request_id: i.active,
                    current: result(&i.current),
                    actions,
                    attempts: i
                        .attempts
                        .iter()
                        .map(|a| ImportAttempt {
                            request_id: a.id.clone(),
                            action: match a.action {
                                owner::Action::Original => ImportAttemptAction::Original,
                                owner::Action::Retry => ImportAttemptAction::Retry,
                                owner::Action::Recopy => ImportAttemptAction::Recopy,
                                owner::Action::Confirm => ImportAttemptAction::Confirm,
                            },
                            ended: a.ended,
                            result: result(&a.result),
                        })
                        .collect(),
                }
            })
            .collect(),
    }
}
pub(crate) fn action(a: ImportAction) -> owner::Action {
    match a {
        ImportAction::Retry => owner::Action::Retry,
        ImportAction::Recopy => owner::Action::Recopy,
        ImportAction::Confirm => owner::Action::Confirm,
    }
}
