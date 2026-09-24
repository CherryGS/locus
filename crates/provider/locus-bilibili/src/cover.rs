use crate::{
    capture::BilibiliSnapshot,
    error::BilibiliError,
    identity::BilibiliId,
    persistence,
    record::{OriginalCover, WriteOutcome},
    service::BilibiliService,
};
use locus_core::api::Kernel;
use locus_file::api::{CurrentInput, FileService, observe_input_in};
use locus_store::api::{Context, Session};

/// Opaque intended snapshot/target observation; acceptance rechecks it in the write unit.
#[derive(Debug)]
pub struct PreparedCover {
    id: BilibiliId,
    revision: i64,
    target: OriginalCover,
}
impl BilibiliService {
    pub async fn prepare_cover(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        id: BilibiliId,
        target: OriginalCover,
    ) -> Result<PreparedCover, BilibiliError> {
        let kernel = kernel.clone();
        session
            .transaction(move |c| {
                Box::pin(async move { Self::prepare_cover_in(&kernel, c, id, target).await })
            })
            .await
    }
    pub async fn prepare_cover_in(
        kernel: &Kernel,
        c: &mut Context,
        id: BilibiliId,
        target: OriginalCover,
    ) -> Result<PreparedCover, BilibiliError> {
        let record = Self::read_in(c, id).await?;
        if observe_input_in(kernel, c, target.entity).await? != CurrentInput::File(target.file) {
            return Err(BilibiliError::AssociationContext);
        }
        FileService::read_in(c, target.file).await?;
        Ok(PreparedCover {
            id,
            revision: record.revision,
            target,
        })
    }
    pub async fn associate_cover(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        prepared: PreparedCover,
    ) -> Result<WriteOutcome, BilibiliError> {
        let kernel = kernel.clone();
        session
            .transaction(move |c| {
                Box::pin(async move { Self::associate_cover_in(&kernel, c, prepared).await })
            })
            .await
    }
    pub async fn associate_cover_in(
        kernel: &Kernel,
        c: &mut Context,
        prepared: PreparedCover,
    ) -> Result<WriteOutcome, BilibiliError> {
        Self::accept_cover_in(kernel, c, prepared, None).await
    }
    /// Explicit complete replacement with this Source's qualified cover carried forward.
    /// A cover from a different Source is not a carry-forward operation.
    pub async fn replace_with_cover(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        prepared: PreparedCover,
        snapshot: BilibiliSnapshot,
    ) -> Result<WriteOutcome, BilibiliError> {
        let kernel = kernel.clone();
        session
            .transaction(move |c| {
                Box::pin(async move {
                    Self::replace_with_cover_in(&kernel, c, prepared, snapshot).await
                })
            })
            .await
    }
    pub async fn replace_with_cover_in(
        kernel: &Kernel,
        c: &mut Context,
        prepared: PreparedCover,
        snapshot: BilibiliSnapshot,
    ) -> Result<WriteOutcome, BilibiliError> {
        snapshot.validate()?;
        Self::accept_cover_in(kernel, c, prepared, Some(snapshot)).await
    }
    async fn accept_cover_in(
        kernel: &Kernel,
        c: &mut Context,
        prepared: PreparedCover,
        snapshot: Option<BilibiliSnapshot>,
    ) -> Result<WriteOutcome, BilibiliError> {
        let mut record = Self::read_in(c, prepared.id).await?;
        if record.revision != prepared.revision {
            return Ok(WriteOutcome::RejectedRevisionChanged);
        }
        if observe_input_in(kernel, c, prepared.target.entity).await?
            != CurrentInput::File(prepared.target.file)
        {
            return Ok(WriteOutcome::RejectedContextChanged);
        }
        FileService::read_in(c, prepared.target.file).await?;
        if let Some(snapshot) = snapshot {
            if record.original_cover != Some(prepared.target) {
                return Ok(WriteOutcome::RejectedContextChanged);
            }
            record.snapshot = snapshot;
            record.basis = None;
        }
        record.revision = record
            .revision
            .checked_add(1)
            .ok_or(BilibiliError::RevisionExhausted(prepared.id))?;
        record.original_cover = Some(prepared.target);
        persistence::update(c, &record).await?;
        Ok(WriteOutcome::Accepted(Box::new(record)))
    }
}
