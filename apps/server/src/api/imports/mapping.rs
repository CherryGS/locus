use super::dto::*;
use crate::{
    api::media::{dto::PreviewOrigin, mapping as media},
    imports as owner,
};
fn step(s: &owner::Step) -> ImportStep {
    ImportStep {
        reason: s.reason.clone(),
        state: match s.state {
            owner::State::NotRequested => ImportStepState::NotRequested,
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
fn result(
    r: &owner::ResultState,
    ended: bool,
    snapshot: Option<&owner::SourceSnapshot>,
) -> ImportResult {
    ImportResult {
        civitai: r
            .civitai
            .as_ref()
            .map(crate::api::civitai::mapping::outcome),
        model: ImportModelResult {
            component_id: r.model.component.map(|id| id.component().to_string()),
            recognition: step(&r.model.recognition),
            establishment: step(&r.model.establishment),
            inspection: step(&r.model.inspection),
        },
        observation_problem: r.observation_problem.clone(),
        copy: step(&r.copy),
        registration: step(&r.registration),
        file_attachment: step(&r.file_attachment),
        twitter: if matches!(snapshot, Some(owner::SourceSnapshot::Twitter(_))) {
            step(&r.source_capture)
        } else {
            step(&owner::Step::new(owner::State::NotRequested))
        },
        bilibili: if matches!(snapshot, Some(owner::SourceSnapshot::Bilibili(_))) {
            step(&r.source_capture)
        } else {
            step(&owner::Step::new(owner::State::NotRequested))
        },
        association: step(&r.association),
        twitter_id: r.source_id.and_then(|id| {
            if let owner::SourceId::Twitter(id) = id {
                Some(id.to_string())
            } else {
                None
            }
        }),
        bilibili_id: r.source_id.and_then(|id| {
            if let owner::SourceId::Bilibili(id) = id {
                Some(id.to_string())
            } else {
                None
            }
        }),
        confirmed_file_id: r
            .file
            .filter(|_| r.registration.success())
            .map(|v| v.to_string()),
        confirmed_entity_id: r.entity.filter(|_| r.base.success()).map(|v| v.to_string()),
        overall: ended.then_some(if r.complete() {
            ImportOverall::Success
        } else {
            ImportOverall::Failure
        }),
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
        access_context: b.access_context,
        original_request_id: b.original_request_id,
        original_overall: b.ended.then_some(
            if b.items
                .iter()
                .all(|i| i.attempts.first().is_some_and(|a| a.result.complete()))
            {
                ImportOverall::Success
            } else {
                ImportOverall::Failure
            },
        ),
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
                } else if i.current.registration.success() || i.supplied {
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
                    supplied: i.supplied,
                    requested_file: !i.supplied || i.current.file.is_some(),
                    requested_twitter: matches!(
                        i.snapshot,
                        Some(owner::SourceSnapshot::Twitter(_))
                    ),
                    requested_bilibili: matches!(
                        i.snapshot,
                        Some(owner::SourceSnapshot::Bilibili(_))
                    ),
                    source_path: i.source,
                    active_request_id: i.active.clone(),
                    current: result(&i.current, i.active.is_none(), i.snapshot.as_ref()),
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
                            result: result(&a.result, a.ended, i.snapshot.as_ref()),
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
