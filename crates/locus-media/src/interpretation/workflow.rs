use super::attempt::{ApplyOutcome, PreparedInterpretation};
use crate::{
    adapters::{image as image_adapter, video},
    error::{AttemptFailure, FailureCode, MediaError},
    facts::Facts,
    identity::{MediaId, MediaKind},
    persistence,
    service::MediaService,
};
use locus_core::api::Kernel;
use locus_file::api::FileService;
use locus_store::api::{Context, Session};

impl MediaService {
    pub async fn prepare(
        &self,
        kernel: &Kernel,
        files: &FileService,
        session: &mut Session,
        id: impl Into<MediaId>,
    ) -> Result<PreparedInterpretation, MediaError> {
        self.prepare_expected(kernel, files, session, id.into(), None)
            .await
    }
    /// Capture only the caller's original host and File; acceptance still checks
    /// the captured revision and context after decoder work.
    pub async fn prepare_expected(
        &self,
        kernel: &Kernel,
        files: &FileService,
        session: &mut Session,
        id: MediaId,
        expected: Option<crate::input::ExpectedInput>,
    ) -> Result<PreparedInterpretation, MediaError> {
        let kernel = kernel.clone();
        let (record, observed) = session
            .transaction_named("Media input observation", move |c| {
                Box::pin(async move {
                    let observed = Self::context_in(&kernel, c, id).await?;
                    let record = Self::read_in(c, id).await?;
                    if let Some(expected) = expected {
                        expected.check(observed)?;
                        if expected
                            .revision
                            .is_some_and(|revision| revision != record.revision)
                        {
                            return Err(MediaError::NewerAttempt);
                        }
                    }
                    Ok::<_, MediaError>((record, observed))
                })
            })
            .await?;
        let result = match observed.file() {
            None => Err(AttemptFailure::new(
                FailureCode::MissingInput,
                format!("{observed:?}"),
            )),
            Some(file) => match files.local_path(session, file).await {
                Err(
                    error @ (locus_file::api::FileError::Store(_)
                    | locus_file::api::FileError::Database(_)
                    | locus_file::api::FileError::Task(_)),
                ) => return Err(error.into()),
                Err(error) => Err(AttemptFailure::new(FailureCode::FileAccess, error)),
                Ok(input) => {
                    self.task_work(
                        session.task_context(),
                        "Media inspection",
                        move |storage| async move {
                            Ok(match id.kind() {
                                MediaKind::Image => image_adapter::inspect(&storage, input)
                                    .await
                                    .map(Facts::Image),
                                MediaKind::Video => {
                                    video::inspect(&storage, input).await.map(Facts::Video)
                                }
                            })
                        },
                    )
                    .await?
                }
            },
        };
        Ok(PreparedInterpretation {
            id,
            revision: record.revision,
            observed,
            result,
        })
    }
    pub async fn apply(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        prepared: PreparedInterpretation,
    ) -> Result<ApplyOutcome, MediaError> {
        let kernel = kernel.clone();
        session
            .transaction_named("Media interpretation acceptance", move |c| {
                Box::pin(async move { Self::apply_in(&kernel, c, prepared).await })
            })
            .await
    }
    /// Success is provisional until the Context's owner commits.
    pub async fn apply_in(
        kernel: &Kernel,
        context: &mut Context,
        prepared: PreparedInterpretation,
    ) -> Result<ApplyOutcome, MediaError> {
        let mut record = Self::read_in(context, prepared.id).await?;
        if record.revision != prepared.revision {
            return Ok(ApplyOutcome::RejectedNewerAttempt);
        }
        if Self::context_in(kernel, context, prepared.id).await? != prepared.observed {
            return Ok(ApplyOutcome::RejectedContextChanged);
        }
        match prepared.result {
            Ok(facts) => {
                record.facts = Some(facts);
                record.basis = prepared.observed.file();
                record.last_failure = None;
            }
            Err(failure) => {
                record.last_failure = Some(failure);
            }
        }
        record.revision = record
            .revision
            .checked_add(1)
            .ok_or_else(|| MediaError::Corrupt("revision exhausted".into()))?;
        persistence::update(context, &record).await?;
        Ok(ApplyOutcome::Accepted(record))
    }
    pub async fn interpret(
        &self,
        kernel: &Kernel,
        files: &FileService,
        session: &mut Session,
        id: impl Into<MediaId>,
    ) -> Result<ApplyOutcome, MediaError> {
        let prepared = self.prepare(kernel, files, session, id).await?;
        self.apply(kernel, session, prepared).await
    }
}
