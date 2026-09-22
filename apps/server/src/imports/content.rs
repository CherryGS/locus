use super::{
    model::*,
    store::ImportStore,
    workflow::{candidate, failed},
};
use crate::runtime::composition::Domain;
use locus_core::api::{EntityId, Kernel, Membership};
use locus_file::api::{FILE_KIND, FileService};
use locus_store::api::{Context, Session};
use locus_twitter::api::{TWITTER_KIND, TwitterService, WriteOutcome};
use std::sync::{Arc, Mutex};

async fn entity(
    kernel: &Kernel,
    c: &mut Context,
    existing: Option<EntityId>,
) -> anyhow::Result<EntityId> {
    if let Some(id) = existing {
        anyhow::ensure!(
            kernel.entity_exists_in(c, id).await?,
            "Original Entity context no longer exists"
        );
        Ok(id)
    } else {
        Ok(kernel.create_entity_in(c).await?)
    }
}
impl ImportStore {
    pub(super) async fn establish(
        &self,
        d: &Domain,
        session: &mut Session,
        batch: &str,
        item: &mut Item,
    ) {
        // Confirmed content is checked before later writes. A missing old
        // membership is never permission to restore it or adopt another target.
        if item.current.base.success()
            && let Err(e) = self.check_content(d, session, item).await
        {
            item.current.observation_problem =
                Some(format!("Original content context cannot be used: {e}"));
            return;
        }
        #[cfg(test)]
        {
            let pause = self.pause_content.lock().unwrap().take();
            if let Some((entered, release)) = pause {
                entered.notify_one();
                release.notified().await;
            }
        }
        if item.current.registration.success() && !item.current.file_attachment.success() {
            let Some(file) = item.current.file else {
                return;
            };
            let retained = item.current.clone();
            let retained_snapshot = item.snapshot.clone();
            let existing = item
                .current
                .base
                .success()
                .then_some(item.current.entity)
                .flatten();
            let kernel = d.kernel.clone();
            let cell = Arc::new(Mutex::new(None));
            let captured = cell.clone();
            item.current.file_attachment = Step::new(State::Running);
            if existing.is_none() {
                item.current.base = Step::new(State::Running);
            }
            self.publish(batch, item);
            #[cfg(test)]
            let fault = self.base_fault.lock().unwrap().take();
            let result = session.transaction_named("Establish Entity and registered File attachment", move |c| Box::pin(async move {
                if retained.base.success() { check_content_in(&kernel, c, &retained, retained_snapshot.as_ref()).await?; }
                    FileService::read_in(c, file).await?;
                anyhow::ensure!(kernel.attachment_in(c, file.component()).await?.is_none(), "Registered File is already attached; its Entity is not this item's target");
                let id = entity(&kernel, c, existing).await?;
                *captured.lock().unwrap_or_else(|e| e.into_inner()) = Some(id);
                kernel.attach_in(c, Membership { entity: id, kind: FILE_KIND, component: file.component() }).await?;
                #[cfg(test)] if matches!(fault, Some(super::store::BaseFault::Rollback)) { anyhow::bail!("test: entry rollback"); }
                Ok::<_, anyhow::Error>(id)
            })).await;
            #[cfg(test)]
            let result =
                if result.is_ok() && matches!(fault, Some(super::store::BaseFault::Unknown)) {
                    Err(locus_store::api::StoreError::CommitOutcomeUnknown(
                        diesel::result::Error::RollbackTransaction,
                    )
                    .into())
                } else {
                    result
                };
            match result {
                Ok(id) => {
                    item.current.entity = Some(id);
                    item.current.base = Step::new(State::Success);
                    item.current.file_attachment = Step::new(State::Success);
                    item.current.effect += 1;
                }
                Err(e) => {
                    let step = failed(e);
                    if existing.is_none() {
                        item.current.entity = candidate(&cell);
                        item.current.base = step.clone();
                    }
                    item.current.file_attachment = step;
                }
            }
            self.publish(batch, item);
        }
        // A definitely rolled-back File unit permits Source to establish the
        // intended entry independently. Uncertainty cannot authorize another unit.
        if item.current.uncertain() {
            if item.current.twitter.state == State::Pending {
                item.current.twitter =
                    Step::error(State::Skipped, "Entry establishment is unconfirmed");
            }
            self.blocked_content(item);
            return;
        }
        if let Some(snapshot) = item.snapshot.clone()
            && !item.current.twitter.success()
        {
            let retained = item.current.clone();
            let retained_snapshot = item.snapshot.clone();
            let existing = item
                .current
                .base
                .success()
                .then_some(item.current.entity)
                .flatten();
            let kernel = d.kernel.clone();
            let cell = Arc::new(Mutex::new(None));
            let captured = cell.clone();
            item.current.twitter = Step::new(State::Running);
            self.publish(batch, item);
            #[cfg(test)]
            let fault = self.source_fault.lock().unwrap().take();
            let result = session
                .transaction_named("Establish Twitter snapshot and attachment", move |c| {
                    Box::pin(async move {
                        if retained.base.success() {
                            check_content_in(&kernel, c, &retained, retained_snapshot.as_ref())
                                .await?;
                        }
                        let entity = entity(&kernel, c, existing).await?;
                        let id = TwitterService::create_in(&kernel, c, snapshot).await?;
                        *captured.lock().unwrap_or_else(|e| e.into_inner()) = Some((entity, id));
                        kernel
                            .attach_in(
                                c,
                                Membership {
                                    entity,
                                    kind: TWITTER_KIND,
                                    component: id.component(),
                                },
                            )
                            .await?;
                        #[cfg(test)]
                        if matches!(fault, Some(super::store::BaseFault::Rollback)) {
                            anyhow::bail!("test: Source rollback");
                        }
                        Ok::<_, anyhow::Error>((entity, id))
                    })
                })
                .await;
            #[cfg(test)]
            let result = uncertain_fault(result, fault);
            match result {
                Ok((entity, id)) => {
                    item.current.entity = Some(entity);
                    item.current.twitter_id = Some(id);
                    item.current.twitter_revision = Some(0);
                    item.current.base = Step::new(State::Success);
                    item.current.twitter = Step::new(State::Success);
                    item.current.effect += 1;
                }
                Err(e) => {
                    let step = failed(e);
                    if step.state == State::Uncertain
                        && let Some((entity, id)) = candidate(&cell)
                    {
                        item.current.entity = Some(entity);
                        item.current.twitter_id = Some(id);
                        item.current.twitter_revision = Some(0);
                    }
                    if existing.is_none() {
                        item.current.base = step.clone();
                    }
                    item.current.twitter = step;
                }
            }
            self.publish(batch, item);
        }
        if item.current.file_attachment.success()
            && item.current.twitter.success()
            && !item.current.association.success()
        {
            let (Some(id), Some(file), Some(entity), Some(revision), Some(snapshot)) = (
                item.current.twitter_id,
                item.current.file,
                item.current.entity,
                item.current.twitter_revision,
                item.snapshot.clone(),
            ) else {
                return;
            };
            let kernel = d.kernel.clone();
            item.current.association = Step::new(State::Running);
            self.publish(batch, item);
            #[cfg(test)]
            let fault = self.association_fault.lock().unwrap().take();
            let result = session
                .transaction_named(
                    "Associate intended Twitter observation and File",
                    move |c| {
                        Box::pin(async move {
                            let record = TwitterService::read_in(c, id).await?;
                            anyhow::ensure!(
                                record.revision == revision && record.snapshot == snapshot,
                                "Intended Twitter snapshot was revised"
                            );
                            anyhow::ensure!(
                                kernel.attachment_in(c, id.component()).await?
                                    == Some(Membership {
                                        entity,
                                        kind: TWITTER_KIND,
                                        component: id.component()
                                    }),
                                "Twitter hosting context changed"
                            );
                            let prepared =
                                TwitterService::prepare_association_in(&kernel, c, id, file)
                                    .await?;
                            match TwitterService::associate_in(&kernel, c, prepared).await? {
                                WriteOutcome::Accepted(record) => {
                                    #[cfg(test)]
                                    if matches!(fault, Some(super::store::BaseFault::Rollback)) {
                                        anyhow::bail!("test: association rollback");
                                    }
                                    Ok(record.revision)
                                }
                                _ => anyhow::bail!("Twitter association context changed"),
                            }
                        })
                    },
                )
                .await;
            #[cfg(test)]
            let result = uncertain_fault(result, fault);
            match result {
                Ok(revision) => {
                    item.current.twitter_revision = Some(revision);
                    item.current.association = Step::new(State::Success);
                    item.current.effect += 1;
                }
                Err(e) => item.current.association = failed(e),
            }
            self.publish(batch, item);
        }
        self.blocked_content(item);
    }

    fn blocked_content(&self, item: &mut Item) {
        if !item.current.file_attachment.success() {
            for kind in &mut item.current.kinds {
                if kind.recognition.state == State::Pending {
                    kind.recognition =
                        Step::error(State::Skipped, "Requires confirmed File attachment");
                    kind.establishment = kind.recognition.clone();
                    kind.interpretation = kind.recognition.clone();
                    kind.preview = kind.recognition.clone();
                }
            }
        }
        if item.snapshot.is_some()
            && item.current.file.is_some()
            && (!item.current.file_attachment.success() || !item.current.twitter.success())
        {
            item.current.association = Step::error(
                State::Skipped,
                "Requires confirmed intended File and Twitter attachments",
            );
        }
    }

    async fn check_content(
        &self,
        d: &Domain,
        session: &mut Session,
        item: &Item,
    ) -> anyhow::Result<()> {
        let r = item.current.clone();
        let snapshot = item.snapshot.clone();
        let kernel = d.kernel.clone();
        session
            .transaction_named("Check retained import content", move |c| {
                Box::pin(async move { check_content_in(&kernel, c, &r, snapshot.as_ref()).await })
            })
            .await
    }

    pub(super) async fn confirm_content(
        &self,
        d: &Domain,
        session: &mut Session,
        item: &mut Item,
    ) -> anyhow::Result<()> {
        let r = item.current.clone();
        let snapshot = item.snapshot.clone();
        let kernel = d.kernel.clone();
        let observed = session
            .transaction_named("Confirm original content units", move |c| {
                Box::pin(async move {
                    let registration = if let Some(file) = r.file {
                        FileService::read_in(c, file).await?;
                        true
                    } else {
                        false
                    };
                    let Some(entity) = r.entity else {
                        return Ok::<_, anyhow::Error>((registration, false, false, None));
                    };
                    if !kernel.entity_exists_in(c, entity).await? {
                        anyhow::bail!(
                            "Candidate Entity is absent; absence does not establish non-commit"
                        );
                    }
                    let attached = if let Some(file) = r.file {
                        kernel.attachment_in(c, file.component()).await?
                            == Some(Membership {
                                entity,
                                kind: FILE_KIND,
                                component: file.component(),
                            })
                    } else {
                        false
                    };
                    let mut twitter = false;
                    let mut associated_revision = None;
                    if let Some(id) = r.twitter_id {
                        let record = TwitterService::read_in(c, id).await?;
                        let expected_revision = r.twitter_revision.unwrap_or(0);
                        let association_committed = r.association.state == State::Uncertain
                            && record.revision == expected_revision + 1
                            && record.basis == r.file;
                        anyhow::ensure!(
                            Some(record.snapshot) == snapshot
                                && (record.revision == expected_revision || association_committed),
                            "Original Twitter observation was revised"
                        );
                        twitter = kernel.attachment_in(c, id.component()).await?
                            == Some(Membership {
                                entity,
                                kind: TWITTER_KIND,
                                component: id.component(),
                            });
                        if association_committed && attached && twitter {
                            associated_revision = Some(record.revision);
                        }
                    }
                    anyhow::ensure!(
                        !r.file_attachment.success() || attached,
                        "Original confirmed File attachment changed"
                    );
                    anyhow::ensure!(
                        !r.twitter.success() || twitter,
                        "Original confirmed Twitter attachment changed"
                    );
                    Ok((registration, attached, twitter, associated_revision))
                })
            })
            .await;
        match observed {
            Ok((registration, attached, twitter, associated_revision)) => {
                if registration && item.current.registration.state == State::Uncertain {
                    item.current.registration = Step::new(State::Success);
                    item.current.effect += 1;
                }
                if attached && item.current.file_attachment.state == State::Uncertain {
                    item.current.file_attachment = Step::new(State::Success);
                    item.current.effect += 1;
                }
                if twitter && item.current.twitter.state == State::Uncertain {
                    item.current.twitter = Step::new(State::Success);
                    item.current.effect += 1;
                }
                if item.current.base.state == State::Uncertain && (attached || twitter) {
                    item.current.base = Step::new(State::Success);
                }
                if let Some(revision) = associated_revision {
                    item.current.twitter_revision = Some(revision);
                    item.current.association = Step::new(State::Success);
                    item.current.effect += 1;
                }
            }
            Err(e) => {
                item.current.observation_problem = Some(format!(
                    "Original content observation failed: {e}. Present absence is not proof of rollback."
                ))
            }
        }
        Ok(())
    }
}

#[cfg(test)]
fn uncertain_fault<T>(
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

async fn check_content_in(
    kernel: &Kernel,
    c: &mut Context,
    r: &ResultState,
    snapshot: Option<&locus_twitter::api::TwitterSnapshot>,
) -> anyhow::Result<()> {
    let entity = r
        .entity
        .ok_or_else(|| anyhow::anyhow!("No intended Entity"))?;
    anyhow::ensure!(
        kernel.entity_exists_in(c, entity).await?,
        "Original Entity is missing"
    );
    if r.file_attachment.success()
        && let Some(file) = r.file
    {
        FileService::read_in(c, file).await?;
        anyhow::ensure!(
            kernel.attachment_in(c, file.component()).await?
                == Some(Membership {
                    entity,
                    kind: FILE_KIND,
                    component: file.component()
                }),
            "Original File attachment changed"
        );
    }
    if r.twitter.success()
        && let Some(id) = r.twitter_id
    {
        let record = TwitterService::read_in(c, id).await?;
        anyhow::ensure!(
            Some(record.revision) == r.twitter_revision && Some(&record.snapshot) == snapshot,
            "Original Twitter observation changed"
        );
        anyhow::ensure!(
            kernel.attachment_in(c, id.component()).await?
                == Some(Membership {
                    entity,
                    kind: TWITTER_KIND,
                    component: id.component()
                }),
            "Original Twitter attachment changed"
        );
    }
    Ok(())
}
