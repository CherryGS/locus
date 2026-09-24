use super::dto::*;
use crate::api::error::{ApiError, ErrorCode};
use locus_civitai::api as d;
pub(crate) fn error(e: impl ToString) -> ApiError {
    ApiError::new(ErrorCode::OperationFailed, e.to_string())
}
pub(crate) fn domain(e: d::CivitaiError) -> ApiError {
    let code = match &e {
        d::CivitaiError::MissingRecord(_) => ErrorCode::NotFound,
        d::CivitaiError::Conflict => ErrorCode::RequestConflict,
        _ => ErrorCode::OperationFailed,
    };
    ApiError::new(code, e.to_string())
}
fn json(v: &impl serde::Serialize) -> Result<String, ApiError> {
    serde_json::to_string(v).map_err(error)
}
pub(crate) fn version(v: &d::ModelVersion) -> Result<CivitaiVersion, ApiError> {
    Ok(CivitaiVersion {
        id: v.id.to_string(),
        name: v.name.clone(),
        description: v.description.clone(),
        base_model: v.base_model.clone(),
        files: v
            .files
            .iter()
            .map(|f| {
                Ok(CivitaiFile {
                    id: f.id.to_string(),
                    name: f.name.clone(),
                    kind: f.kind.clone(),
                    raw_json: json(f)?,
                })
            })
            .collect::<Result<_, ApiError>>()?,
        images: v
            .images
            .iter()
            .map(|i| {
                Ok(CivitaiImage {
                    id: i.id.map(|v| v.to_string()),
                    kind: i.kind.clone(),
                    raw_json: json(i)?,
                })
            })
            .collect::<Result<_, ApiError>>()?,
        raw_json: json(v)?,
    })
}
pub(crate) fn view(v: d::CivitaiView) -> Result<CivitaiView, ApiError> {
    let r = v.record;
    let m = &r.snapshot.model;
    let (input, problem) = input(v.input);
    Ok(CivitaiView {
        record: CivitaiRecord {
            component_id: r.id.to_string(),
            revision: r.revision.to_string(),
            observation: r.observation,
            file_id: r.basis.to_string(),
            matched_version: r.snapshot.matched_version.to_string(),
            matched_file: r.snapshot.matched_file.to_string(),
            blake3: r.snapshot.blake3,
            model: CivitaiModel {
                id: m.id.to_string(),
                name: m.name.clone(),
                description: m.description.clone(),
                kind: m.kind.clone(),
                tags: m.tags.clone(),
                versions: m
                    .model_versions
                    .iter()
                    .map(version)
                    .collect::<Result<_, _>>()?,
                raw_json: json(m)?,
            },
            lookup_json: json(&r.snapshot.lookup)?,
        },
        host: v.host.map(|h| h.to_string()),
        input,
        problem,
    })
}
fn input(i: d::InputStatus) -> (CivitaiInput, Option<String>) {
    match i {
        d::InputStatus::Current => (CivitaiInput::Current, None),
        d::InputStatus::Changed => (CivitaiInput::Changed, None),
        d::InputStatus::Missing => (CivitaiInput::Missing, None),
        d::InputStatus::Unmounted => (CivitaiInput::Unmounted, None),
        d::InputStatus::Failed(e) => (CivitaiInput::Failed, Some(e)),
    }
}
fn source(s: d::SourceReference) -> CivitaiSource {
    CivitaiSource {
        component_id: s.component.to_string(),
        entity_id: s.entity.to_string(),
        observation: s.observation,
        revision: s.revision.to_string(),
    }
}
fn correspondence(c: d::Correspondence) -> CivitaiCorrespondence {
    let (input, problem) = input(c.input);
    CivitaiCorrespondence {
        source: source(c.source),
        version: c.version.to_string(),
        file: c.file.to_string(),
        basis: c.basis.to_string(),
        input,
        problem,
        blake3: c.blake3,
    }
}
pub(crate) fn page(p: d::Page) -> Result<CivitaiPage, ApiError> {
    Ok(CivitaiPage {
        origin: view(p.origin)?,
        versions: p
            .versions
            .into_iter()
            .map(|v| CivitaiDirectoryEntry {
                id: v.id.to_string(),
                in_origin: v.in_origin,
                sources: v.sources.into_iter().map(source).collect(),
            })
            .collect(),
        correspondences: p.correspondences.into_iter().map(correspondence).collect(),
    })
}
fn binding(b: &d::ExampleBinding) -> CivitaiBinding {
    CivitaiBinding {
        occurrence: b.occurrence,
        remote_id: b.representation.id.map(|v| v.to_string()),
        entity_id: b.entity.to_string(),
        file_id: b.file.to_string(),
        acquired_observation: b.acquired_observation.clone(),
        content_type: b.content_type.clone(),
        complete: b.complete,
        media: b
            .media
            .iter()
            .map(|m| crate::api::media::mapping::target(m.id()))
            .collect(),
    }
}
pub(crate) fn version_view(v: d::VersionView) -> Result<CivitaiVersionView, ApiError> {
    Ok(CivitaiVersionView {
        model: v.model.to_string(),
        source: source(v.source),
        in_origin: v.in_origin,
        version: version(&v.version)?,
        correspondences: v.correspondences.into_iter().map(correspondence).collect(),
        examples: v
            .examples
            .into_iter()
            .map(|e| CivitaiManagedExample {
                source: source(e.source),
                binding: binding(&e.binding),
                applicable: e.applicable,
                problem: e.problem,
            })
            .collect(),
    })
}
pub(crate) fn outcome(w: &d::Enrichment) -> CivitaiOutcome {
    CivitaiOutcome {
        first_only: w.first_only(),
        requested_examples: w
            .record()
            .and_then(|r| r.snapshot.matched().ok().map(|v| v.images.len())),
        entity_id: w.entity().to_string(),
        file_id: w.file().to_string(),
        state: match w.state() {
            d::EnrichmentState::Pending => CivitaiState::Pending,
            d::EnrichmentState::Running => CivitaiState::Running,
            d::EnrichmentState::Complete => CivitaiState::Complete,
            d::EnrichmentState::Failed => CivitaiState::Failed,
            d::EnrichmentState::Conflict => CivitaiState::Conflict,
            d::EnrichmentState::Uncertain => CivitaiState::Uncertain,
        },
        metadata: match w.metadata() {
            d::MetadataState::Pending => CivitaiMetadataState::Pending,
            d::MetadataState::Accepted => CivitaiMetadataState::Accepted,
            d::MetadataState::NoMatch => CivitaiMetadataState::NoMatch,
            d::MetadataState::Failed => CivitaiMetadataState::Failed,
            d::MetadataState::Conflict => CivitaiMetadataState::Conflict,
            d::MetadataState::Uncertain => CivitaiMetadataState::Uncertain,
        },
        component_id: w.known_component().map(|id| id.to_string()),
        observation: w.known_observation().map(str::to_owned),
        problem: w.problem().map(str::to_owned),
        effect_revision: w.effect().to_string(),
        examples: w
            .examples()
            .map(|e| CivitaiExampleOutcome {
                preparations: e
                    .preparations
                    .iter()
                    .map(|p| crate::api::file::dto::CopyProgress {
                        file_id: p.id.to_string(),
                        relative_path: p.relative_path.clone(),
                        bytes_written: p.bytes_written.to_string(),
                        managed_bytes_may_exist: p.managed_bytes_may_exist,
                        copy_complete: p.copy_complete,
                    })
                    .collect(),
                file_registered: e.file_registered,
                target_candidate: e.target_candidate.map(|id| id.to_string()),
                target_confirmed: e.target_confirmed,
                registration_uncertain: e.registration_uncertain,
                occurrence: e.occurrence,
                remote_id: e.representation.id.map(|v| v.to_string()),
                state: match e.state {
                    d::ExampleState::Pending => CivitaiState::Pending,
                    d::ExampleState::Running => CivitaiState::Running,
                    d::ExampleState::Complete => CivitaiState::Complete,
                    d::ExampleState::Failed => CivitaiState::Failed,
                    d::ExampleState::Conflict => CivitaiState::Conflict,
                    d::ExampleState::Uncertain => CivitaiState::Uncertain,
                },
                binding: e.binding.as_ref().map(binding),
                reused: e.reused,
                prepared_file: e.prepared_file.map(|v| v.to_string()),
                problem: e.problem.clone(),
            })
            .collect(),
    }
}
