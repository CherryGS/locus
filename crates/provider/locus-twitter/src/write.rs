use crate::{
    capture::TwitterSnapshot,
    error::TwitterError,
    identity::{TWITTER_KIND, TwitterId},
    persistence,
    record::{TwitterRecord, WriteOutcome},
    service::TwitterService,
};
use locus_core::api::{ComponentId, Kernel};
use locus_store::api::{Context, Session};

impl TwitterService {
    pub async fn create(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        snapshot: TwitterSnapshot,
    ) -> Result<TwitterId, TwitterError> {
        let kernel = kernel.clone();
        session
            .transaction(move |c| {
                Box::pin(async move { Self::create_in(&kernel, c, snapshot).await })
            })
            .await
    }
    /// Success remains provisional until the caller commits its transaction.
    pub async fn create_in(
        kernel: &Kernel,
        context: &mut Context,
        snapshot: TwitterSnapshot,
    ) -> Result<TwitterId, TwitterError> {
        snapshot.validate()?;
        let kernel = kernel.clone();
        context
            .savepoint(move |c| {
                Box::pin(async move {
                    let id = TwitterId::from_component(ComponentId::new());
                    persistence::insert(
                        c,
                        &TwitterRecord {
                            id,
                            revision: 0,
                            snapshot,
                            basis: None,
                        },
                    )
                    .await?;
                    kernel
                        .admit_component_in(c, TWITTER_KIND, id.component())
                        .await?;
                    Ok(id)
                })
            })
            .await
    }
    pub async fn replace(
        &self,
        session: &mut Session,
        id: TwitterId,
        expected_revision: i64,
        snapshot: TwitterSnapshot,
    ) -> Result<WriteOutcome, TwitterError> {
        session
            .transaction(move |c| Box::pin(Self::replace_in(c, id, expected_revision, snapshot)))
            .await
    }
    /// Replaces the entire snapshot and clears association; never merges old fields.
    /// Accepted work is provisional until the caller's transaction commits.
    pub async fn replace_in(
        context: &mut Context,
        id: TwitterId,
        expected_revision: i64,
        snapshot: TwitterSnapshot,
    ) -> Result<WriteOutcome, TwitterError> {
        snapshot.validate()?;
        let mut record = Self::read_in(context, id).await?;
        if record.revision != expected_revision {
            return Ok(WriteOutcome::RejectedRevisionChanged);
        }
        record.revision = record
            .revision
            .checked_add(1)
            .ok_or(TwitterError::RevisionExhausted(id))?;
        record.snapshot = snapshot;
        record.basis = None;
        persistence::update(context, &record).await?;
        Ok(WriteOutcome::Accepted(Box::new(record)))
    }
}
