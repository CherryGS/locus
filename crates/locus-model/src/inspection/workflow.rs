use super::attempt::{ApplyOutcome, PreparedInspection};
use crate::{
    error::{AttemptFailure, FailureCode, ModelError},
    identity::ModelId,
    persistence,
    service::ModelService,
};
use locus_core::api::Kernel;
use locus_file::api::FileService;
use locus_store::api::{Context, Session};

impl ModelService {
    pub async fn prepare(
        &self,
        kernel: &Kernel,
        files: &FileService,
        session: &mut Session,
        id: impl Into<ModelId>,
    ) -> Result<PreparedInspection, ModelError> {
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
        id: ModelId,
        expected: Option<crate::input::ExpectedInput>,
    ) -> Result<PreparedInspection, ModelError> {
        let kernel = kernel.clone();
        let (record, observed) = session
            .transaction_named("Model input observation", move |c| {
                Box::pin(async move {
                    let observed = Self::context_in(&kernel, c, id).await?;
                    let record = Self::read_in(c, id).await?;
                    if let Some(expected) = expected {
                        expected.check(observed)?;
                        if expected
                            .revision
                            .is_some_and(|revision| revision != record.revision)
                        {
                            return Err(ModelError::NewerAttempt);
                        }
                    }
                    Ok::<_, ModelError>((record, observed))
                })
            })
            .await?;
        let result = match observed.file() {
            None => Err(AttemptFailure::new(
                FailureCode::MissingInput,
                match observed {
                    crate::input::InputContext::Unmounted => {
                        "Model is not attached to an Entity".into()
                    }
                    crate::input::InputContext::Hosted {
                        host,
                        input: locus_file::api::CurrentInput::MissingEntity(_),
                    } => format!("Hosting Entity {host} is missing"),
                    crate::input::InputContext::Hosted { host, .. } => {
                        format!("Hosting Entity {host} has no File attached")
                    }
                },
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
                        "Model inspection",
                        move |service| async move {
                            Ok(finish_worker(
                                service
                                    .blocking(move || {
                                        let extent = input
                                            .handle()
                                            .metadata()
                                            .map_err(|e| {
                                                AttemptFailure::new(FailureCode::FileAccess, e)
                                            })?
                                            .len();
                                        crate::adapters::inspect(&mut input.into_reader(), extent)
                                    })
                                    .await,
                            ))
                        },
                    )
                    .await?
                }
            },
        };
        Ok(PreparedInspection {
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
        prepared: PreparedInspection,
    ) -> Result<ApplyOutcome, ModelError> {
        let kernel = kernel.clone();
        session
            .transaction_named("Model inspection acceptance", move |c| {
                Box::pin(async move { Self::apply_in(&kernel, c, prepared).await })
            })
            .await
    }
    /// Success is provisional until the Context's owner commits.
    pub async fn apply_in(
        kernel: &Kernel,
        context: &mut Context,
        prepared: PreparedInspection,
    ) -> Result<ApplyOutcome, ModelError> {
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
            .ok_or_else(|| ModelError::Corrupt("revision exhausted".into()))?;
        persistence::update(context, &record).await?;
        Ok(ApplyOutcome::Accepted(Box::new(record)))
    }
    pub async fn inspect(
        &self,
        kernel: &Kernel,
        files: &FileService,
        session: &mut Session,
        id: impl Into<ModelId>,
    ) -> Result<ApplyOutcome, ModelError> {
        let prepared = self.prepare(kernel, files, session, id).await?;
        self.apply(kernel, session, prepared).await
    }
}
pub(super) fn finish_worker(
    result: Result<Result<crate::record::Inspection, AttemptFailure>, tokio::task::JoinError>,
) -> Result<crate::record::Inspection, AttemptFailure> {
    result.unwrap_or_else(|e| Err(AttemptFailure::new(FailureCode::Worker, e)))
}
