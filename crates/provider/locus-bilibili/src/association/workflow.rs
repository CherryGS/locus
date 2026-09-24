use super::prepared::PreparedAssociation;
use crate::{
    capture::BilibiliSnapshot, error::BilibiliError, identity::BilibiliId, input::InputContext,
    persistence, record::WriteOutcome, service::BilibiliService,
};
use locus_core::api::Kernel;
use locus_file::api::{CurrentInput, FileError, FileId, FileService};
use locus_store::api::{Context, Session};

impl BilibiliService {
    pub async fn prepare_association(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        id: BilibiliId,
        file: FileId,
    ) -> Result<PreparedAssociation, BilibiliError> {
        let kernel = kernel.clone();
        session
            .transaction_named("Bilibili association observation", move |c| {
                Box::pin(async move { Self::prepare_association_in(&kernel, c, id, file).await })
            })
            .await
    }
    pub async fn prepare_association_in(
        kernel: &Kernel,
        context: &mut Context,
        id: BilibiliId,
        file: FileId,
    ) -> Result<PreparedAssociation, BilibiliError> {
        let record = Self::read_in(context, id).await?;
        let InputContext::Hosted {
            host,
            input: CurrentInput::File(current),
        } = Self::context_in(kernel, context, id).await?
        else {
            return Err(BilibiliError::AssociationContext);
        };
        if current != file {
            return Err(BilibiliError::AssociationContext);
        }
        FileService::read_in(context, file).await?;
        Ok(PreparedAssociation {
            id,
            revision: record.revision,
            host,
            file,
        })
    }
    pub async fn associate(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        prepared: PreparedAssociation,
    ) -> Result<WriteOutcome, BilibiliError> {
        let kernel = kernel.clone();
        session
            .transaction_named("Bilibili association acceptance", move |c| {
                Box::pin(async move { Self::associate_in(&kernel, c, prepared).await })
            })
            .await
    }
    /// Success is provisional until the owner of Context commits.
    pub async fn associate_in(
        kernel: &Kernel,
        context: &mut Context,
        prepared: PreparedAssociation,
    ) -> Result<WriteOutcome, BilibiliError> {
        Self::accept_association_in(kernel, context, prepared, None).await
    }
    pub async fn replace_and_associate(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        prepared: PreparedAssociation,
        snapshot: BilibiliSnapshot,
    ) -> Result<WriteOutcome, BilibiliError> {
        let kernel = kernel.clone();
        session
            .transaction_named("Bilibili replacement and association", move |c| {
                Box::pin(async move {
                    Self::replace_and_associate_in(&kernel, c, prepared, snapshot).await
                })
            })
            .await
    }
    /// One guarded row update accepts the complete new snapshot/basis/revision.
    /// Validation/conflict cannot leave half a replacement, even if caught by caller.
    pub async fn replace_and_associate_in(
        kernel: &Kernel,
        context: &mut Context,
        prepared: PreparedAssociation,
        snapshot: BilibiliSnapshot,
    ) -> Result<WriteOutcome, BilibiliError> {
        snapshot.validate()?;
        Self::accept_association_in(kernel, context, prepared, Some(snapshot)).await
    }
    async fn accept_association_in(
        kernel: &Kernel,
        context: &mut Context,
        prepared: PreparedAssociation,
        snapshot: Option<BilibiliSnapshot>,
    ) -> Result<WriteOutcome, BilibiliError> {
        let mut record = Self::read_in(context, prepared.id).await?;
        if record.revision != prepared.revision {
            return Ok(WriteOutcome::RejectedRevisionChanged);
        }
        let expected = InputContext::Hosted {
            host: prepared.host,
            input: CurrentInput::File(prepared.file),
        };
        if Self::context_in(kernel, context, prepared.id).await? != expected {
            return Ok(WriteOutcome::RejectedContextChanged);
        }
        match FileService::read_in(context, prepared.file).await {
            Ok(_) => (),
            Err(FileError::MissingRecord(_)) => return Ok(WriteOutcome::RejectedContextChanged),
            Err(error) => return Err(error.into()),
        }
        record.revision = record
            .revision
            .checked_add(1)
            .ok_or(BilibiliError::RevisionExhausted(prepared.id))?;
        if let Some(snapshot) = snapshot {
            record.snapshot = snapshot;
            record.original_cover = None;
        }
        record.basis = Some(prepared.file);
        persistence::update(context, &record).await?;
        Ok(WriteOutcome::Accepted(Box::new(record)))
    }
}
