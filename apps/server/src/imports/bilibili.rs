use super::{
    model::*,
    store::ImportStore,
    workflow::{candidate, failed},
};
use crate::runtime::composition::Domain;
use locus_bilibili::api::{BILIBILI_KIND, BilibiliService, WriteOutcome};
use locus_core::api::{Kernel, Membership};
use locus_store::api::{Context, Session};
use std::sync::{Arc, Mutex};

pub(super) async fn guard_in(
    kernel: &Kernel,
    c: &mut Context,
    r: &ResultState,
) -> anyhow::Result<()> {
    if let Some(b) = &r.bilibili
        && b.source.success()
    {
        let id =
            b.id.ok_or_else(|| anyhow::anyhow!("Missing original Bilibili identity"))?;
        let record = BilibiliService::read_in(c, id).await?;
        anyhow::ensure!(
            Some(record.revision) == b.revision && record.snapshot == b.snapshot,
            "Original Bilibili observation changed"
        );
        anyhow::ensure!(
            kernel.attachment_in(c, id.component()).await?
                == r.entity.map(|entity| Membership {
                    entity,
                    kind: BILIBILI_KIND,
                    component: id.component()
                }),
            "Original Bilibili membership changed"
        );
        if b.association.success() {
            anyhow::ensure!(
                record.basis == r.file,
                "Original Bilibili local association changed"
            );
        }
        if let Some(cover) = &b.cover
            && cover.association.success()
        {
            anyhow::ensure!(
                record.original_cover
                    == cover
                        .entity
                        .map(|entity| locus_bilibili::api::OriginalCover {
                            entity,
                            file: cover.file
                        }),
                "Original cover relation changed"
            );
        }
    }
    Ok(())
}
impl ImportStore {
    pub(super) async fn establish_bilibili(
        &self,
        d: &Domain,
        session: &mut Session,
        batch: &str,
        item: &mut Item,
    ) {
        let Some(b) = item.current.bilibili.as_ref() else {
            return;
        };
        if b.source.success() || item.current.uncertain() {
            return;
        }
        if b.id.is_some() {
            item.current.observation_problem =
                Some("Original Bilibili identity is unresolved".into());
            return;
        }
        let existing = item
            .current
            .base
            .success()
            .then_some(item.current.entity)
            .flatten();
        let snapshot = b.snapshot.clone();
        let kernel = d.kernel.clone();
        let retained = item.current.clone();
        let cell = Arc::new(Mutex::new(None));
        let captured = cell.clone();
        if let Some(b) = &mut item.current.bilibili {
            b.source = Step::new(State::Running);
        }
        self.publish(batch, item);
        #[cfg(test)]
        let fault = self.bilibili_source_fault.lock().unwrap().take();
        let result = session
            .transaction_named("Establish independent Bilibili Source", move |c| {
                Box::pin(async move {
                    if let Some(entity) = existing {
                        anyhow::ensure!(
                            kernel.entity_exists_in(c, entity).await?,
                            "Original Entity is missing"
                        );
                    }
                    guard_in(&kernel, c, &retained).await?;
                    let entity = match existing {
                        Some(id) => id,
                        None => kernel.create_entity_in(c).await?,
                    };
                    let id = BilibiliService::create_in(&kernel, c, snapshot).await?;
                    *captured.lock().unwrap_or_else(|e| e.into_inner()) = Some((entity, id));
                    kernel
                        .attach_in(
                            c,
                            Membership {
                                entity,
                                kind: BILIBILI_KIND,
                                component: id.component(),
                            },
                        )
                        .await?;
                    #[cfg(test)]
                    if matches!(fault, Some(super::store::BaseFault::Rollback)) {
                        anyhow::bail!("test: Bilibili rollback");
                    }
                    Ok::<_, anyhow::Error>((entity, id))
                })
            })
            .await;
        #[cfg(test)]
        let result = super::bilibili::commit_fault(result, fault);
        let Some(b) = &mut item.current.bilibili else {
            return;
        };
        match result {
            Ok((entity, id)) => {
                b.id = Some(id);
                b.revision = Some(0);
                b.source = Step::new(State::Success);
                item.current.entity = Some(entity);
                item.current.base = Step::new(State::Success);
                item.current.effect += 1;
            }
            Err(e) => {
                let step = failed(e);
                if step.state == State::Uncertain {
                    if let Some((entity, id)) = candidate(&cell) {
                        b.id = Some(id);
                        b.revision = Some(0);
                        item.current.entity = Some(entity);
                    }
                    if existing.is_none() {
                        item.current.base = step.clone();
                    }
                }
                b.source = step;
            }
        }
        self.publish(batch, item);
    }
    pub(super) async fn associate_bilibili(
        &self,
        d: &Domain,
        session: &mut Session,
        batch: &str,
        item: &mut Item,
    ) {
        let Some(b) = &item.current.bilibili else {
            return;
        };
        if !b.source.success()
            || !item.current.file_attachment.success()
            || b.association.success()
            || b.association.state == State::Uncertain
        {
            return;
        }
        let (Some(id), Some(file)) = (b.id, item.current.file) else {
            return;
        };
        let retained = item.current.clone();
        let kernel = d.kernel.clone();
        if let Some(b) = &mut item.current.bilibili {
            b.association = Step::new(State::Running);
        }
        self.publish(batch, item);
        let result = session
            .transaction_named("Associate original Bilibili video File", move |c| {
                Box::pin(async move {
                    guard_in(&kernel, c, &retained).await?;
                    let prepared =
                        BilibiliService::prepare_association_in(&kernel, c, id, file).await?;
                    match BilibiliService::associate_in(&kernel, c, prepared).await? {
                        WriteOutcome::Accepted(r) => Ok(r.revision),
                        _ => anyhow::bail!("Bilibili association context changed"),
                    }
                })
            })
            .await;
        let Some(b) = &mut item.current.bilibili else {
            return;
        };
        match result {
            Ok(revision) => {
                b.revision = Some(revision);
                b.association = Step::new(State::Success);
                item.current.effect += 1
            }
            Err(e) => b.association = failed(e),
        }
        self.publish(batch, item);
    }
    pub(super) async fn confirm_bilibili(
        &self,
        d: &Domain,
        session: &mut Session,
        item: &mut Item,
    ) -> anyhow::Result<()> {
        let Some(b) = item.current.bilibili.clone() else {
            return Ok(());
        };
        let Some(id) = b.id else { return Ok(()) };
        let entity = item
            .current
            .entity
            .ok_or_else(|| anyhow::anyhow!("No original main Entity"))?;
        let kernel = d.kernel.clone();
        let file = item.current.file;
        let observed = session
            .transaction_named("Confirm original Bilibili effects", move |c| {
                Box::pin(async move {
                    let record = BilibiliService::read_in(c, id).await?;
                    anyhow::ensure!(
                        record.snapshot == b.snapshot,
                        "Original Bilibili snapshot changed"
                    );
                    anyhow::ensure!(
                        kernel.attachment_in(c, id.component()).await?
                            == Some(Membership {
                                entity,
                                kind: BILIBILI_KIND,
                                component: id.component()
                            }),
                        "Original Bilibili membership is absent or changed"
                    );
                    let association = b.association.state == State::Uncertain
                        && record.basis == file
                        && file.is_some();
                    let cover = b.cover.as_ref().is_some_and(|v| {
                        v.association.state == State::Uncertain
                            && record.original_cover
                                == v.entity.map(|entity| locus_bilibili::api::OriginalCover {
                                    entity,
                                    file: v.file,
                                })
                    });
                    anyhow::ensure!(
                        Some(record.revision) == b.revision
                            || ((association || cover) && Some(record.revision - 1) == b.revision),
                        "Original Bilibili revision changed"
                    );
                    Ok::<_, anyhow::Error>((record.revision, association, cover))
                })
            })
            .await;
        match observed {
            Ok((revision, associated, cover)) => {
                let Some(b) = &mut item.current.bilibili else {
                    return Ok(());
                };
                b.source = Step::new(State::Success);
                b.revision = Some(revision);
                item.current.base = Step::new(State::Success);
                if associated {
                    b.association = Step::new(State::Success)
                }
                if cover && let Some(c) = &mut b.cover {
                    c.association = Step::new(State::Success)
                }
                item.current.effect += 1;
            }
            Err(e) => {
                item.current.observation_problem = Some(format!(
                    "Original Bilibili effects cannot be confirmed: {e}"
                ))
            }
        }
        Ok(())
    }
}

#[cfg(test)]
pub(super) fn commit_fault<T>(
    result: anyhow::Result<T>,
    fault: Option<super::store::BaseFault>,
) -> anyhow::Result<T> {
    if result.is_ok() && matches!(fault, Some(super::store::BaseFault::Unknown)) {
        Err(locus_store::api::StoreError::CommitOutcomeUnknown(
            diesel::result::Error::RollbackTransaction,
        )
        .into())
    } else {
        result
    }
}
