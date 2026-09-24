use super::{
    bilibili_state::CoverResult,
    model::*,
    store::ImportStore,
    workflow::{candidate, failed},
};
use crate::runtime::composition::Domain;
use locus_bilibili::api::{BilibiliService, OriginalCover, WriteOutcome};
use locus_core::api::Membership;
use locus_file::api::{CurrentInput, FILE_KIND, FileService, observe_input_in};
use locus_media::api::{
    ApplyOutcome, ExpectedInput, MediaKind, MediaService, Recognition, Rendition,
};
use locus_store::api::{Context, Session};
use std::sync::{Arc, Mutex};

async fn target(
    kernel: &locus_core::api::Kernel,
    c: &mut Context,
    cover: &CoverResult,
) -> anyhow::Result<()> {
    let entity = cover
        .entity
        .ok_or_else(|| anyhow::anyhow!("No original cover Entity"))?;
    anyhow::ensure!(
        observe_input_in(kernel, c, entity).await? == CurrentInput::File(cover.file),
        "Original cover Entity/File changed"
    );
    FileService::read_in(c, cover.file).await?;
    if let Some(id) = cover.image.component {
        anyhow::ensure!(
            kernel.attachment_in(c, id.component()).await?
                == Some(Membership {
                    entity,
                    kind: MediaKind::Image.kind(),
                    component: id.component()
                }),
            "Original cover Image changed"
        );
    }
    Ok(())
}
impl ImportStore {
    fn publish_cover(&self, batch: &str, item: &mut Item, cover: &CoverResult) {
        if let Some(b) = &mut item.current.bilibili {
            b.cover = Some(cover.clone());
        }
        self.publish(batch, item);
    }
    pub(super) async fn process_bilibili_cover(
        &self,
        d: &Domain,
        s: &mut Session,
        batch: &str,
        item: &mut Item,
    ) {
        let Some(mut cover) = item.current.bilibili.as_ref().and_then(|b| b.cover.clone()) else {
            return;
        };
        if cover.establishment.state == State::Uncertain {
            return;
        }
        if cover.establishment.success() {
            let kernel = d.kernel.clone();
            let retained = cover.clone();
            if let Err(e) = s
                .transaction(move |c| Box::pin(async move { target(&kernel, c, &retained).await }))
                .await
            {
                cover.establishment = Step::error(State::Conflict, e);
                self.publish_cover(batch, item, &cover);
                return;
            }
        } else {
            if cover.entity.is_some() {
                cover.establishment =
                    Step::error(State::Conflict, "Original cover target is unresolved");
                self.publish_cover(batch, item, &cover);
                return;
            }
            cover.establishment = Step::new(State::Running);
            self.publish_cover(batch, item, &cover);
            let kernel = d.kernel.clone();
            let file = cover.file;
            let cell = Arc::new(Mutex::new(None));
            let captured = cell.clone();
            #[cfg(test)]
            let fault = self.bilibili_cover_fault.lock().unwrap().take();
            let result = s
                .transaction_named(
                    "Establish independent cover Entity and exact File",
                    move |c| {
                        Box::pin(async move {
                            FileService::read_in(c, file).await?;
                            anyhow::ensure!(
                                kernel.attachment_in(c, file.component()).await?.is_none(),
                                "Cover File is already attached; adoption is not permitted"
                            );
                            let entity = kernel.create_entity_in(c).await?;
                            *captured.lock().unwrap_or_else(|e| e.into_inner()) = Some(entity);
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
                            #[cfg(test)]
                            if matches!(fault, Some(super::store::BaseFault::Rollback)) {
                                anyhow::bail!("test: Bilibili rollback");
                            }
                            Ok::<_, anyhow::Error>(entity)
                        })
                    },
                )
                .await;
            #[cfg(test)]
            let result = super::bilibili::commit_fault(result, fault);
            match result {
                Ok(entity) => {
                    cover.entity = Some(entity);
                    cover.establishment = Step::new(State::Success);
                    item.current.effect += 1
                }
                Err(e) => {
                    let step = failed(e);
                    if step.state == State::Uncertain {
                        cover.entity = candidate(&cell)
                    }
                    cover.establishment = step;
                    self.publish_cover(batch, item, &cover);
                    return;
                }
            }
            self.publish_cover(batch, item, &cover);
        }
        // Relation is independent of Image decoding; failed Image work must not erase it.
        if let Some(b) = &item.current.bilibili
            && b.source.success()
            && !cover.association.success()
            && cover.association.state != State::Uncertain
            && let (Some(id), Some(entity)) = (b.id, cover.entity)
        {
            let kernel = d.kernel.clone();
            let retained = item.current.clone();
            let relation = OriginalCover {
                entity,
                file: cover.file,
            };
            cover.association = Step::new(State::Running);
            self.publish_cover(batch, item, &cover);
            let result = s
                .transaction_named("Associate this item's original cover", move |c| {
                    Box::pin(async move {
                        super::bilibili::guard_in(&kernel, c, &retained).await?;
                        let prepared =
                            BilibiliService::prepare_cover_in(&kernel, c, id, relation).await?;
                        match BilibiliService::associate_cover_in(&kernel, c, prepared).await? {
                            WriteOutcome::Accepted(r) => Ok(r.revision),
                            _ => anyhow::bail!("Original Source or cover changed"),
                        }
                    })
                })
                .await;
            match result {
                Ok(revision) => {
                    if let Some(b) = &mut item.current.bilibili {
                        b.revision = Some(revision)
                    }
                    cover.association = Step::new(State::Success);
                    item.current.effect += 1
                }
                Err(e) => cover.association = failed(e),
            }
            self.publish_cover(batch, item, &cover);
        }
        if !cover.image.recognition.success() {
            cover.image.recognition = Step::new(State::Running);
            self.publish_cover(batch, item, &cover);
            cover.image.recognition = match d.media.recognize(&d.files, s, cover.file).await {
                Ok(found) => match found.image {
                    Recognition::Match => Step::new(State::Success),
                    Recognition::NoMatch => Step::error(
                        State::NoMatch,
                        "Requested original cover did not match Image",
                    ),
                    Recognition::Failed(e) => Step::error(State::Failed, e),
                },
                Err(e) => failed(e.into()),
            };
            #[cfg(test)]
            if std::mem::take(&mut *self.force_image_match.lock().unwrap()) {
                cover.image.recognition = Step::new(State::Success);
            }
            if !cover.image.recognition.success() {
                cover.image.establishment =
                    Step::error(State::Skipped, "Requires positive Image recognition");
                cover.image.interpretation = cover.image.establishment.clone();
                cover.image.preview = cover.image.establishment.clone();
                self.publish_cover(batch, item, &cover);
                return;
            }
            self.publish_cover(batch, item, &cover);
        }
        let Some(entity) = cover.entity else { return };
        if !cover.image.establishment.success() {
            if cover.image.component.is_some() {
                cover.image.establishment = Step::error(
                    State::Conflict,
                    "Original Image establishment is unresolved",
                );
                self.publish_cover(batch, item, &cover);
                return;
            }
            cover.image.establishment = Step::new(State::Running);
            self.publish_cover(batch, item, &cover);
            let kernel = d.kernel.clone();
            let retained = cover.clone();
            let cell = Arc::new(Mutex::new(None));
            let captured = cell.clone();
            #[cfg(test)]
            let fault = self.bilibili_image_fault.lock().unwrap().take();
            let result = s
                .transaction_named("Establish original cover Image", move |c| {
                    Box::pin(async move {
                        target(&kernel, c, &retained).await?;
                        let id = MediaService::create_in(&kernel, c, MediaKind::Image).await?;
                        *captured.lock().unwrap_or_else(|e| e.into_inner()) = Some(id);
                        kernel
                            .attach_in(
                                c,
                                Membership {
                                    entity,
                                    kind: MediaKind::Image.kind(),
                                    component: id.component(),
                                },
                            )
                            .await?;
                        Ok::<_, anyhow::Error>(id)
                    })
                })
                .await;
            #[cfg(test)]
            let result = super::bilibili::commit_fault(result, fault);
            match result {
                Ok(id) => {
                    cover.image.component = Some(id);
                    cover.image.revision = Some(0);
                    cover.image.establishment = Step::new(State::Success);
                    item.current.effect += 1
                }
                Err(e) => {
                    let step = failed(e);
                    if step.state == State::Uncertain {
                        cover.image.component = candidate(&cell);
                        cover.image.revision = Some(0);
                    }
                    cover.image.establishment = step;
                    self.publish_cover(batch, item, &cover);
                    return;
                }
            }
            self.publish_cover(batch, item, &cover);
        }
        let Some(id) = cover.image.component else {
            return;
        };
        let mut expected = ExpectedInput {
            entity,
            file: cover.file,
            revision: cover.image.revision,
        };
        if cover.image.interpretation.success() {
            match d.media.view(&d.kernel, s, id).await {
                Ok(v)
                    if Some(v.record.revision) == cover.image.revision
                        && v.record.basis == Some(cover.file)
                        && v.record.last_failure.is_none()
                        && matches!(v.applicability,locus_media::api::Applicability::Input(locus_file::api::InputComparison::Matching(f)) if f==cover.file) =>
                    {}
                other => {
                    cover.image.preview = Step::error(
                        State::Conflict,
                        format!("Original Image evidence changed: {other:?}"),
                    );
                    self.publish_cover(batch, item, &cover);
                    return;
                }
            }
        } else {
            cover.image.interpretation = Step::new(State::Running);
            self.publish_cover(batch, item, &cover);
            let result = async {
                let prepared = d
                    .media
                    .prepare_expected(&d.kernel, &d.files, s, id, Some(expected))
                    .await?;
                d.media.apply(&d.kernel, s, prepared).await
            }
            .await;
            #[cfg(test)]
            let result = if matches!(result, Ok(ApplyOutcome::Accepted(_)))
                && std::mem::take(&mut *self.unknown_interpretation.lock().unwrap())
            {
                Err(locus_media::api::MediaError::Store(
                    locus_store::api::StoreError::CommitOutcomeUnknown(
                        diesel::result::Error::RollbackTransaction,
                    ),
                ))
            } else {
                result
            };
            match result {
                Ok(ApplyOutcome::Accepted(record)) => {
                    cover.image.revision = Some(record.revision);
                    cover.image.interpretation = record.last_failure.map_or_else(
                        || Step::new(State::Success),
                        |e| Step::error(State::Failed, e),
                    );
                    item.current.effect += 1
                }
                Ok(other) => {
                    cover.image.interpretation = Step::error(State::Conflict, format!("{other:?}"))
                }
                Err(e) => cover.image.interpretation = failed(e.into()),
            }
            self.publish_cover(batch, item, &cover);
            if !cover.image.interpretation.success() {
                return;
            }
        }
        expected.revision = cover.image.revision;
        cover.image.preview = Step::new(State::Running);
        self.publish_cover(batch, item, &cover);
        match d
            .media
            .preview_expected(
                &d.kernel,
                &d.files,
                s,
                id,
                Rendition { edge: 320 },
                Some(expected),
            )
            .await
        {
            Ok(output) => {
                cover.image.output = Some(Arc::new(output));
                cover.image.locator = Some(uuid::Uuid::now_v7().to_string());
                cover.image.preview = Step::new(State::Success);
                item.current.effect += 1
            }
            Err(e) => cover.image.preview = failed(e.into()),
        }
        self.publish_cover(batch, item, &cover);
    }
    pub(super) async fn confirm_bilibili_cover(
        &self,
        d: &Domain,
        s: &mut Session,
        item: &mut Item,
    ) -> anyhow::Result<()> {
        let Some(mut cover) = item.current.bilibili.as_ref().and_then(|b| b.cover.clone()) else {
            return Ok(());
        };
        if cover.entity.is_none() {
            return Ok(());
        }
        let retained = cover.clone();
        let kernel = d.kernel.clone();
        let result = s
            .transaction_named("Confirm original cover effects", move |c| {
                Box::pin(async move {
                    target(&kernel, c, &retained).await?;
                    let image = match retained.image.component {
                        Some(id) => Some(MediaService::read_in(c, id).await?),
                        None => None,
                    };
                    Ok::<_, anyhow::Error>(image)
                })
            })
            .await;
        match result {
            Ok(image) => {
                cover.establishment = Step::new(State::Success);
                if let Some(record) = image {
                    if cover.image.establishment.state == State::Uncertain {
                        if record.revision == 0
                            && record.facts.is_none()
                            && record.last_failure.is_none()
                        {
                            cover.image.establishment = Step::new(State::Success);
                            cover.image.revision = Some(0);
                        } else {
                            item.current.observation_problem = Some("Original cover Image was changed before creation confirmation; no creating retry is authorized.".into());
                        }
                    }
                    if cover.image.interpretation.state == State::Uncertain
                        && record.revision > cover.image.revision.unwrap_or(-1)
                    {
                        if let Some(failure) = &record.last_failure {
                            cover.image.interpretation = Step::error(
                                State::Failed,
                                format!(
                                    "Current Image warning observed: {failure}; original attempt acceptance remains unconfirmed"
                                ),
                            );
                            cover.image.revision = Some(record.revision);
                        } else if record.basis == Some(cover.file) && record.facts.is_some() {
                            cover.image.interpretation = Step::error(
                                State::Success,
                                "Current applicable successful Image interpretation observed; original attempt acceptance remains unconfirmed",
                            );
                            cover.image.revision = Some(record.revision);
                        }
                    }
                }
                item.current.effect += 1;
            }
            Err(e) => {
                item.current.observation_problem =
                    Some(format!("Original cover effects cannot be confirmed: {e}"))
            }
        }
        if let Some(b) = &mut item.current.bilibili {
            b.cover = Some(cover);
        }
        Ok(())
    }
}

impl ImportStore {
    pub(super) async fn validate_bilibili(
        &self,
        d: &Domain,
        s: &mut Session,
        item: &Item,
    ) -> anyhow::Result<()> {
        let Some(b) = &item.current.bilibili else {
            return Ok(());
        };
        let kernel = d.kernel.clone();
        let retained = item.current.clone();
        let cover = b.cover.clone();
        let accepted_cover = b.cover.clone();
        s.transaction_named("Validate requested Bilibili effects", move |c| {
            Box::pin(async move {
                super::bilibili::guard_in(&kernel, c, &retained).await?;
                if let Some(cover) = cover {
                    if cover.establishment.success() {
                        target(&kernel, c, &cover).await?;
                    }
                    if cover.image.interpretation.success() {
                        let id = cover
                            .image
                            .component
                            .ok_or_else(|| anyhow::anyhow!("Missing requested Image"))?;
                        let r = MediaService::read_in(c, id).await?;
                        anyhow::ensure!(
                            Some(r.revision) == cover.image.revision
                                && r.basis == Some(cover.file)
                                && r.facts.is_some()
                                && r.last_failure.is_none(),
                            "Requested cover Image evidence changed"
                        );
                        if cover.image.preview.success() {
                            anyhow::ensure!(
                                cover.image.output.as_ref().is_some_and(
                                    |p| p.file == cover.file && p.kind == MediaKind::Image
                                ),
                                "Requested cover preview evidence changed"
                            );
                        }
                    }
                }
                Ok::<_, anyhow::Error>(())
            })
        })
        .await?;
        if let Some(c) = accepted_cover.filter(|c| c.image.preview.success()) {
            let id = c
                .image
                .component
                .ok_or_else(|| anyhow::anyhow!("Missing cover Image"))?;
            let output = d
                .media
                .read_preview(&d.kernel, s, id, Rendition { edge: 320 })
                .await?;
            anyhow::ensure!(
                output.is_some_and(|v| v.file == c.file && v.kind == MediaKind::Image),
                "Requested cover preview is no longer available for its input"
            );
        }
        Ok(())
    }
}
