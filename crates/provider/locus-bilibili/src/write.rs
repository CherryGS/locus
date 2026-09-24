use crate::{
    capture::BilibiliSnapshot,
    error::BilibiliError,
    identity::{BILIBILI_KIND, BilibiliId},
    persistence,
    record::{BilibiliRecord, WriteOutcome},
    service::BilibiliService,
};
use locus_core::api::{ComponentId, Kernel};
use locus_store::api::{Context, Session};

impl BilibiliService {
    pub async fn create(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        snapshot: BilibiliSnapshot,
    ) -> Result<BilibiliId, BilibiliError> {
        let kernel = kernel.clone();
        session
            .transaction_named("Bilibili snapshot creation", move |c| {
                Box::pin(async move { Self::create_in(&kernel, c, snapshot).await })
            })
            .await
    }
    /// Success remains provisional until the caller commits its transaction.
    pub async fn create_in(
        kernel: &Kernel,
        context: &mut Context,
        snapshot: BilibiliSnapshot,
    ) -> Result<BilibiliId, BilibiliError> {
        if let Some(stage) = context.task_stage() {
            snapshot_progress(stage, "Validating and saving Bilibili snapshot");
        }
        snapshot.validate()?;
        let kernel = kernel.clone();
        context
            .savepoint(move |c| {
                Box::pin(async move {
                    let id = BilibiliId::from_component(ComponentId::new());
                    persistence::insert(
                        c,
                        &BilibiliRecord {
                            id,
                            revision: 0,
                            snapshot,
                            basis: None,
                        },
                    )
                    .await?;
                    kernel
                        .admit_component_in(c, BILIBILI_KIND, id.component())
                        .await?;
                    Ok(id)
                })
            })
            .await
    }
    pub async fn replace(
        &self,
        session: &mut Session,
        id: BilibiliId,
        expected_revision: i64,
        snapshot: BilibiliSnapshot,
    ) -> Result<WriteOutcome, BilibiliError> {
        session
            .transaction_named("Bilibili snapshot replacement", move |c| {
                Box::pin(Self::replace_in(c, id, expected_revision, snapshot))
            })
            .await
    }
    /// Replaces the entire snapshot and clears association; never merges old fields.
    /// Accepted work is provisional until the caller's transaction commits.
    pub async fn replace_in(
        context: &mut Context,
        id: BilibiliId,
        expected_revision: i64,
        snapshot: BilibiliSnapshot,
    ) -> Result<WriteOutcome, BilibiliError> {
        if let Some(stage) = context.task_stage() {
            snapshot_progress(stage, "Validating and replacing Bilibili snapshot");
        }
        snapshot.validate()?;
        let mut record = Self::read_in(context, id).await?;
        if record.revision != expected_revision {
            return Ok(WriteOutcome::RejectedRevisionChanged);
        }
        record.revision = record
            .revision
            .checked_add(1)
            .ok_or(BilibiliError::RevisionExhausted(id))?;
        record.snapshot = snapshot;
        record.basis = None;
        persistence::update(context, &record).await?;
        Ok(WriteOutcome::Accepted(Box::new(record)))
    }
}

fn snapshot_progress(stage: &locus_task::api::Stage, message: &str) {
    stage.progress(None, None, message);
}
