use super::{
    ExampleBinding, ExampleState, ExampleWork, MediaCompletion, validate_binding_in,
    validate_observation_in,
};
use crate::{
    enrichment::{Enrichment, EnrichmentState, MetadataState, fail, file_uncertain, uncertain},
    error::CivitaiError,
    persistence,
    record::CivitaiRecord,
    service::CivitaiService,
};
use locus_core::api::{EntityId, Kernel, Membership};
use locus_file::api::{CurrentInput, FILE_KIND, FileService, observe_input_in};
use locus_media::api::{ApplyOutcome, MediaKind, MediaService, Recognition, Rendition};
use locus_store::api::Session;
use std::{
    io::Write,
    sync::{Arc, Mutex},
};

#[derive(Clone, Copy)]
struct ExampleOwners<'a> {
    kernel: &'a Kernel,
    files: &'a FileService,
    media: &'a MediaService,
}
impl CivitaiService {
    /// Runs or continues the same accepted work. The observer receives effects as
    /// they become known, including metadata before any example is acquired.
    pub async fn enrich(
        &self,
        k: &Kernel,
        files: &FileService,
        media: &MediaService,
        s: &mut Session,
        work: &mut Enrichment,
        observe: &(dyn Fn(&Enrichment) + Send + Sync),
    ) {
        work.state = EnrichmentState::Running;
        work.problem = None;
        observe(work);
        if let Err(e) = self.metadata(k, files, s, work).await {
            fail(work, &e);
            observe(work);
            return;
        }
        observe(work);
        if work.metadata == MetadataState::NoMatch {
            match self.validate_completion(k, s, work).await {
                Ok(()) => work.state = EnrichmentState::Complete,
                Err(e) => fail(work, &e),
            }
            observe(work);
            return;
        }
        let Some(record) = work.record.clone() else {
            return;
        };
        if work.examples.is_empty() {
            match record.snapshot.matched() {
                Ok(version) => {
                    work.examples = version
                        .images
                        .iter()
                        .cloned()
                        .enumerate()
                        .map(|(i, v)| {
                            let mut w = ExampleWork::new(i, v);
                            if let Some(binding) =
                                record.examples.iter().find(|b| b.occurrence == i)
                            {
                                w.outcome.binding = Some(binding.clone());
                                w.outcome.reused = true;
                                w.relationship_confirmed = true;
                            }
                            w
                        })
                        .collect();
                }
                Err(e) => {
                    fail(work, &e);
                    observe(work);
                    return;
                }
            }
        }
        for index in 0..work.examples.len() {
            let mut example = work.examples[index].clone();
            example.outcome.state = ExampleState::Running;
            example.outcome.problem = None;
            work.examples[index] = example.clone();
            observe(work);
            let previous_effect = example.effect;
            let progress = |entry: &ExampleWork| {
                let mut current = work.clone();
                current.examples[index] = entry.clone();
                current.effect += entry.effect - previous_effect;
                observe(&current);
            };
            let result = self
                .example(
                    ExampleOwners {
                        kernel: k,
                        files,
                        media,
                    },
                    s,
                    work.entity,
                    &record,
                    &mut example,
                    &progress,
                )
                .await;
            work.effect += example.effect - previous_effect;
            if let Err(e) = result {
                example.outcome.state = if uncertain(&e)
                    || example.registration_uncertain
                    || example.target_uncertain
                    || example.component_uncertain
                    || example.relationship_uncertain
                    || !example.interpretation_uncertain.is_empty()
                {
                    ExampleState::Uncertain
                } else if matches!(e, CivitaiError::Conflict) {
                    ExampleState::Conflict
                } else {
                    ExampleState::Failed
                };
                example.outcome.problem = Some(e.to_string());
            }
            work.examples[index] = example;
            work.effect += 1;
            observe(work);
        }
        match self.validate_completion(k, s, work).await {
            Ok(()) => work.state = EnrichmentState::Complete,
            Err(e) => fail(work, &e),
        }
        observe(work);
    }
    pub async fn validate_completion(
        &self,
        k: &Kernel,
        s: &mut Session,
        work: &Enrichment,
    ) -> Result<(), CivitaiError> {
        let k = k.clone();
        let work = work.clone();
        s.transaction_named("Accept whole Civitai result", move |c| {
            Box::pin(async move { Self::validate_completion_in(&k, c, &work).await })
        })
        .await
    }
    /// Participates in a consumer's short, coherent result-acceptance boundary.
    pub async fn validate_completion_in(
        k: &Kernel,
        c: &mut locus_store::api::Context,
        work: &Enrichment,
    ) -> Result<(), CivitaiError> {
        if work.metadata == MetadataState::NoMatch {
            if observe_input_in(k, c, work.entity).await? != CurrentInput::File(work.file) {
                return Err(CivitaiError::Conflict);
            }
            FileService::read_in(c, work.file).await?;
            return Ok(());
        }
        let expected = work.record.as_ref().ok_or(CivitaiError::Conflict)?;
        if work
            .examples
            .iter()
            .any(|e| e.outcome.state != ExampleState::Complete)
        {
            return Err(CivitaiError::Invalid(
                "Required example work remains incomplete".into(),
            ));
        }
        let actual = validate_observation_in(k, c, work.entity, expected).await?;
        let requested = &actual.snapshot.matched()?.images;
        if actual.examples.len() != requested.len() {
            return Err(CivitaiError::Invalid(
                "Required relationships are incomplete".into(),
            ));
        }
        for (i, representation) in requested.iter().enumerate() {
            let matches: Vec<_> = actual
                .examples
                .iter()
                .filter(|b| b.occurrence == i && &b.representation == representation)
                .collect();
            if matches.len() != 1
                || !work
                    .examples
                    .iter()
                    .any(|e| e.outcome.binding.as_ref() == Some(matches[0]))
            {
                return Err(CivitaiError::Conflict);
            }
            validate_binding_in(k, c, matches[0], true).await?;
        }
        Ok(())
    }
    async fn example(
        &self,
        owners: ExampleOwners<'_>,
        s: &mut Session,
        host: EntityId,
        record: &CivitaiRecord,
        w: &mut ExampleWork,
        progress: &(dyn Fn(&ExampleWork) + Send + Sync),
    ) -> Result<(), CivitaiError> {
        let ExampleOwners {
            kernel: k,
            files,
            media,
        } = owners;
        if w.relationship_uncertain {
            let expected = w
                .outcome
                .binding
                .as_ref()
                .ok_or(CivitaiError::Conflict)?
                .clone();
            let current = self.read(s, record.id).await?;
            if current.observation != record.observation
                || !current.examples.iter().any(|b| b == &expected)
            {
                return Err(CivitaiError::Conflict);
            }
            w.relationship_uncertain = false;
            w.relationship_confirmed = true;
        }
        let kernel = k.clone();
        let expected = record.clone();
        s.transaction_named("Observe original example prerequisites", move |c| {
            Box::pin(async move {
                validate_observation_in(&kernel, c, host, &expected)
                    .await
                    .map(|_| ())
            })
        })
        .await?;
        if let Some(binding) = w.outcome.binding.clone() {
            let kernel = k.clone();
            let checked = binding.clone();
            s.transaction(move |c| {
                Box::pin(async move { validate_binding_in(&kernel, c, &checked, false).await })
            })
            .await?;
            if binding.complete {
                if w.relationship_confirmed {
                    let kernel = k.clone();
                    let expected = record.clone();
                    let binding = binding.clone();
                    s.transaction_named("Reobserve completed original example", move |c| {
                        Box::pin(async move {
                            let current =
                                validate_observation_in(&kernel, c, host, &expected).await?;
                            if !current.examples.iter().any(|b| b == &binding) {
                                return Err(CivitaiError::Conflict);
                            }
                            validate_binding_in(&kernel, c, &binding, true).await
                        })
                    })
                    .await?;
                } else {
                    if let Err(e) = self.link(k, s, host, record, &binding).await {
                        w.relationship_uncertain = uncertain(&e);
                        return Err(e);
                    }
                    w.relationship_confirmed = true;
                }
                w.outcome.state = ExampleState::Complete;
                return Ok(());
            }
        } else if w.target_candidate.is_none()
            && w.prepared.is_none()
            && let Some(binding) = self.reuse(k, s, record, w).await?
        {
            w.outcome.reused = true;
            w.outcome.binding = Some(binding.clone());
            if let Err(e) = self.link(k, s, host, record, &binding).await {
                w.relationship_uncertain = uncertain(&e);
                return Err(e);
            }
            w.relationship_confirmed = true;
            w.outcome.state = ExampleState::Complete;
            return Ok(());
        }
        if w.outcome.binding.is_none() {
            self.admit_example(k, files, s, record, w, progress).await?;
        }
        let mut binding = w.outcome.binding.clone().ok_or(CivitaiError::Conflict)?;
        if w.recognition.as_ref().is_none_or(|r| {
            matches!(r.image, Recognition::Failed(_)) || matches!(r.video, Recognition::Failed(_))
        }) {
            let mut found = media.recognize(files, s, binding.file).await?;
            if let Some(old) = &w.recognition {
                if !matches!(old.image, Recognition::Failed(_)) {
                    found.image = old.image.clone();
                }
                if !matches!(old.video, Recognition::Failed(_)) {
                    found.video = old.video.clone();
                }
            }
            w.recognition = Some(found);
        }
        if w.outcome
            .representation
            .kind
            .as_deref()
            .is_some_and(|t| t.eq_ignore_ascii_case("video"))
            && !matches!(
                w.recognition.as_ref().map(|r| &r.video),
                Some(Recognition::Match)
            )
        {
            return Err(CivitaiError::Invalid(
                "A video example requires actual video input; a poster is insufficient".into(),
            ));
        }
        let recognition = w.recognition.clone().ok_or(CivitaiError::Conflict)?;
        let mut errors = Vec::new();
        for (kind, result) in [
            (MediaKind::Image, recognition.image),
            (MediaKind::Video, recognition.video),
        ] {
            match result {
                Recognition::NoMatch => continue,
                Recognition::Failed(e) => {
                    errors.push(e.to_string());
                    continue;
                }
                Recognition::Match => {}
            }
            if let Err(e) = self
                .process_kind(
                    ExampleOwners {
                        kernel: k,
                        files,
                        media,
                    },
                    s,
                    &binding,
                    w,
                    kind,
                    progress,
                )
                .await
            {
                errors.push(e.to_string());
            }
        }
        binding.media = w.components.clone();
        binding.complete = errors.is_empty()
            && !binding.media.is_empty()
            && binding.media.iter().all(|m| m.preview_edge > 0);
        w.outcome.binding = Some(binding.clone());
        // Retain partial target provenance too. It never claims completed Media.
        match self.link(k, s, host, record, &binding).await {
            Ok(()) => {
                w.relationship_uncertain = false;
                w.relationship_confirmed = true;
            }
            Err(e) => {
                w.relationship_uncertain = uncertain(&e);
                return Err(e);
            }
        }
        if !binding.complete {
            return Err(CivitaiError::Invalid(if errors.is_empty() {
                "No supported example Media kind".into()
            } else {
                errors.join("; ")
            }));
        }
        w.outcome.state = ExampleState::Complete;
        Ok(())
    }
    async fn reuse(
        &self,
        k: &Kernel,
        s: &mut Session,
        record: &CivitaiRecord,
        w: &ExampleWork,
    ) -> Result<Option<ExampleBinding>, CivitaiError> {
        let Some(remote) = w.outcome.representation.id else {
            return Ok(None);
        };
        // Duplicate remote identities in this roster are ambiguous even if their
        // URLs happen to agree. Do not conflate their occurrence scopes.
        if record
            .snapshot
            .matched()?
            .images
            .iter()
            .filter(|v| v.id == Some(remote))
            .count()
            != 1
        {
            return Ok(None);
        }
        let kernel = k.clone();
        let model = record.snapshot.model.id;
        let version = record.snapshot.matched_version;
        let representation = w.outcome.representation.clone();
        let occurrence = w.outcome.occurrence;
        s.transaction_named("Find qualified managed example", move |c| {
            Box::pin(async move {
                for source in persistence::model_records(c, model).await? {
                    if source.snapshot.matched_version != version
                        || source
                            .snapshot
                            .matched()?
                            .images
                            .iter()
                            .filter(|v| v.id == Some(remote))
                            .count()
                            != 1
                    {
                        continue;
                    }
                    for mut b in source.examples {
                        if b.representation == representation && b.complete {
                            match validate_binding_in(&kernel, c, &b, true).await {
                                Ok(()) => {
                                    b.occurrence = occurrence;
                                    return Ok(Some(b));
                                }
                                Err(CivitaiError::Conflict) => continue,
                                Err(e) => return Err(e),
                            }
                        }
                    }
                }
                Ok(None)
            })
        })
        .await
    }
    async fn link(
        &self,
        k: &Kernel,
        s: &mut Session,
        host: EntityId,
        record: &CivitaiRecord,
        binding: &ExampleBinding,
    ) -> Result<(), CivitaiError> {
        let kernel = k.clone();
        let expected = record.clone();
        let binding = binding.clone();
        s.transaction_named("Accept Civitai example relationship", move |c| {
            Box::pin(async move {
                let mut actual = validate_observation_in(&kernel, c, host, &expected).await?;
                if actual.snapshot.matched()?.images.get(binding.occurrence)
                    != Some(&binding.representation)
                {
                    return Err(CivitaiError::Conflict);
                }
                if let Some(existing) = actual
                    .examples
                    .iter()
                    .find(|b| b.occurrence == binding.occurrence)
                    && (existing.entity != binding.entity
                        || existing.file != binding.file
                        || existing.media.iter().any(|old| {
                            !binding
                                .media
                                .iter()
                                .any(|new| new.image == old.image && new.component == old.component)
                        }))
                {
                    return Err(CivitaiError::Conflict);
                }
                validate_binding_in(&kernel, c, &binding, binding.complete).await?;
                actual
                    .examples
                    .retain(|b| b.occurrence != binding.occurrence);
                actual.examples.push(binding);
                persistence::update(c, &actual).await
            })
        })
        .await
    }
    async fn admit_example(
        &self,
        k: &Kernel,
        files: &FileService,
        s: &mut Session,
        record: &CivitaiRecord,
        w: &mut ExampleWork,
        progress: &(dyn Fn(&ExampleWork) + Send + Sync),
    ) -> Result<(), CivitaiError> {
        if w.prepared.is_none() {
            let stage = match s.task_context() {
                Some(t) => Some(t.enter("Civitai example acquisition", &[]).await?),
                None => None,
            };
            let acquired = self.upstream.example(&w.outcome.representation).await?;
            let write = move || -> Result<_, CivitaiError> {
                let mut f = tempfile::NamedTempFile::new()?;
                f.write_all(&acquired.bytes)?;
                f.flush()?;
                Ok((f, acquired.content_type))
            };
            let worker = match &stage {
                Some(stage) => stage.spawn_blocking(move |_| write()),
                None => tokio::task::spawn_blocking(write),
            };
            let (temp, content_type) = worker
                .await
                .map_err(|e| CivitaiError::Worker(e.to_string()))??;
            drop(stage);
            let prepared = match s.task_context() {
                Some(t) => files.prepare_task(t, temp.path()).await,
                None => files.prepare(temp.path()).await,
            };
            let prepared = prepared.map_err(|e| {
                w.outcome.prepared_file = Some(e.progress.id);
                w.outcome.preparations.push(*e.progress);
                CivitaiError::File(e.source)
            })?;
            w.outcome.prepared_file = Some(prepared.id());
            w.outcome.preparations.push(prepared.progress().clone());
            w.prepared = Some(prepared);
            w.content_type = Some(content_type);
            w.effect += 1;
            progress(w);
        }
        let prepared = w.prepared.as_ref().ok_or(CivitaiError::Conflict)?;
        let file = prepared.id();
        if w.registration_uncertain {
            let actual = files.read(s, file).await?;
            if actual.byte_count != prepared.progress().bytes_written
                || actual.relative_path != prepared.progress().relative_path
            {
                return Err(CivitaiError::Conflict);
            }
            w.registered = true;
            w.registration_uncertain = false;
        }
        if !w.registered {
            match files.register(k, s, prepared).await {
                Ok(_) => w.registered = true,
                Err(e) => {
                    w.registration_uncertain = file_uncertain(&e);
                    return Err(e.into());
                }
            }
        }
        let entity = if let Some(entity) = w.target_candidate {
            let kernel = k.clone();
            s.transaction(move |c| {
                Box::pin(async move {
                    if observe_input_in(&kernel, c, entity).await? != CurrentInput::File(file) {
                        return Err(CivitaiError::Conflict);
                    }
                    Ok(())
                })
            })
            .await?;
            w.target_uncertain = false;
            entity
        } else {
            let kernel = k.clone();
            let captured = Arc::new(Mutex::new(None));
            let candidate = captured.clone();
            let result = s
                .transaction_named("Admit independent Civitai example Entity", move |c| {
                    Box::pin(async move {
                        FileService::read_in(c, file).await?;
                        let entity = kernel.create_entity_in(c).await?;
                        *candidate.lock().unwrap_or_else(|e| e.into_inner()) = Some(entity);
                        kernel
                            .attach_in(
                                c,
                                Membership {
                                    entity,
                                    kind: FILE_KIND,
                                    component: file.component(),
                                },
                            )
                            .await?;
                        Ok::<_, CivitaiError>(entity)
                    })
                })
                .await;
            match result {
                Ok(entity) => {
                    w.target_candidate = Some(entity);
                    entity
                }
                Err(e) => {
                    if uncertain(&e) {
                        w.target_candidate = *captured.lock().unwrap_or_else(|e| e.into_inner());
                        w.target_uncertain = true;
                    }
                    return Err(e);
                }
            }
        };
        w.outcome.binding = Some(ExampleBinding {
            occurrence: w.outcome.occurrence,
            representation: w.outcome.representation.clone(),
            entity,
            file,
            acquired_observation: record.observation.clone(),
            content_type: w.content_type.clone().ok_or_else(|| {
                CivitaiError::Invalid("Missing original acquisition provenance".into())
            })?,
            media: Vec::new(),
            complete: false,
        });
        w.effect += 1;
        progress(w);
        Ok(())
    }
    async fn process_kind(
        &self,
        owners: ExampleOwners<'_>,
        s: &mut Session,
        binding: &ExampleBinding,
        w: &mut ExampleWork,
        kind: MediaKind,
        progress: &(dyn Fn(&ExampleWork) + Send + Sync),
    ) -> Result<(), CivitaiError> {
        let ExampleOwners {
            kernel: k,
            files,
            media,
        } = owners;
        let image = kind == MediaKind::Image;
        let index = if let Some(i) = w.components.iter().position(|m| m.image == image) {
            i
        } else {
            let kernel = k.clone();
            let target = binding.clone();
            let captured = Arc::new(Mutex::new(None));
            let candidate = captured.clone();
            let result = s
                .transaction_named("Establish example Media kind", move |c| {
                    Box::pin(async move {
                        validate_binding_in(&kernel, c, &target, false).await?;
                        let id = MediaService::create_in(&kernel, c, kind).await?;
                        *candidate.lock().unwrap_or_else(|e| e.into_inner()) = Some(id);
                        kernel
                            .attach_in(
                                c,
                                Membership {
                                    entity: target.entity,
                                    kind: kind.kind(),
                                    component: id.component(),
                                },
                            )
                            .await?;
                        Ok::<_, CivitaiError>(id)
                    })
                })
                .await;
            let id = match result {
                Ok(id) => id,
                Err(e) => {
                    if uncertain(&e)
                        && let Some(id) = *captured.lock().unwrap_or_else(|e| e.into_inner())
                    {
                        w.components.push(MediaCompletion {
                            component: id.component(),
                            image,
                            revision: 0,
                            preview_edge: 0,
                            stream_index: None,
                        });
                        w.component_uncertain = true;
                    }
                    return Err(e);
                }
            };
            w.components.push(MediaCompletion {
                component: id.component(),
                image,
                revision: 0,
                preview_edge: 0,
                stream_index: None,
            });
            w.components.len() - 1
        };
        let id = w.components[index].id();
        let kernel = k.clone();
        let target = binding.clone();
        let part = w.components[index].clone();
        let current = s
            .transaction(move |c| {
                Box::pin(async move {
                    let mut target = target;
                    target.media = vec![part];
                    validate_binding_in(&kernel, c, &target, false).await?;
                    Ok::<_, CivitaiError>(MediaService::read_in(c, id).await?)
                })
            })
            .await?;
        w.component_uncertain = false;
        if w.interpretation_uncertain.contains(&id) {
            if current.revision <= w.components[index].revision {
                return Err(CivitaiError::Invalid(
                    "Original Media acceptance remains unconfirmed".into(),
                ));
            }
            w.interpretation_uncertain
                .retain(|candidate| *candidate != id);
        }
        let current = if current.basis == Some(binding.file)
            && current.facts.is_some()
            && current.last_failure.is_none()
        {
            current
        } else {
            // Ordinary Media capture is intentional: a valid later-input result
            // remains Media's, and is rejected as evidence for this relationship.
            let interpreted = match media.interpret(k, files, s, id).await {
                Ok(value) => value,
                Err(error) => {
                    let error = CivitaiError::Media(error);
                    if uncertain(&error) && !w.interpretation_uncertain.contains(&id) {
                        w.interpretation_uncertain.push(id);
                    }
                    return Err(error);
                }
            };
            match interpreted {
                ApplyOutcome::Accepted(r) => r,
                _ => return Err(CivitaiError::Conflict),
            }
        };
        if current.basis != Some(binding.file)
            || current.facts.is_none()
            || current.last_failure.is_some()
        {
            return Err(CivitaiError::Invalid(
                "Example interpretation did not complete for the intended File".into(),
            ));
        }
        if w.components[index].preview_edge == 0 || w.components[index].revision != current.revision
        {
            let preview = media
                .preview(k, files, s, id, Rendition { edge: 512 })
                .await?;
            if preview.file != binding.file || preview.kind != kind {
                return Err(CivitaiError::Conflict);
            }
            w.components[index].preview_edge = preview.rendition.edge;
            w.components[index].stream_index = preview.stream_index;
        }
        w.components[index].revision = current.revision;
        w.effect += 1;
        progress(w);
        Ok(())
    }
}
