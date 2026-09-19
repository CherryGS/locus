use crate::{
    AttemptFailure, Facts, FailureCode, ImageId, InputContext, MediaError, MediaId, MediaKind,
    MediaRecord, MediaStorage, VideoId, image_adapter, video,
};
use diesel::{
    sql_query,
    sql_types::{BigInt, Binary, Text},
};
use diesel_async::RunQueryDsl;
use locus_core::{ComponentId, Kernel};
use locus_file::FileStorage;
use locus_store::{Context, Session};

/// An opaque observation tied to this component, observed host/File and revision.
/// Dropping preparation writes no record. Decoder work never holds a DB transaction.
pub struct PreparedInterpretation {
    id: MediaId,
    revision: i64,
    observed: InputContext,
    result: Result<Facts, AttemptFailure>,
}

#[cfg(test)]
#[path = "operations_tests.rs"]
mod tests;
#[derive(Debug, Clone, PartialEq)]
pub enum ApplyOutcome {
    Accepted(MediaRecord),
    RejectedContextChanged,
    RejectedNewerAttempt,
}
impl MediaStorage {
    pub async fn create_image(
        &self,
        kernel: &Kernel,
        session: &mut Session,
    ) -> Result<ImageId, MediaError> {
        match self.create(kernel, session, MediaKind::Image).await? {
            MediaId::Image(id) => Ok(id),
            _ => Err(MediaError::Corrupt("creation kind".into())),
        }
    }
    pub async fn create_video(
        &self,
        kernel: &Kernel,
        session: &mut Session,
    ) -> Result<VideoId, MediaError> {
        match self.create(kernel, session, MediaKind::Video).await? {
            MediaId::Video(id) => Ok(id),
            _ => Err(MediaError::Corrupt("creation kind".into())),
        }
    }
    pub async fn create(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        kind: MediaKind,
    ) -> Result<MediaId, MediaError> {
        let kernel = kernel.clone();
        session
            .transaction(move |c| Box::pin(async move { Self::create_in(&kernel, c, kind).await }))
            .await
    }
    pub async fn create_in(
        kernel: &Kernel,
        context: &mut Context,
        kind: MediaKind,
    ) -> Result<MediaId, MediaError> {
        let kernel = kernel.clone();
        context
            .savepoint(move |c| {
                Box::pin(async move {
                    let id = kind.id(ComponentId::new());
                    let record = MediaRecord {
                        id,
                        revision: 0,
                        basis: None,
                        facts: None,
                        last_failure: None,
                    };
                    sql_query(format!(
                        "INSERT INTO {} (id,revision,payload) VALUES (?,0,?)",
                        kind.table()
                    ))
                    .bind::<Binary, _>(id.component().as_bytes().as_slice())
                    .bind::<Text, _>(record.payload()?)
                    .execute(c.connection())
                    .await?;
                    kernel
                        .admit_component_in(c, kind.kind(), id.component())
                        .await?;
                    Ok(id)
                })
            })
            .await
    }
    pub async fn prepare(
        &self,
        kernel: &Kernel,
        files: &FileStorage,
        session: &mut Session,
        id: impl Into<MediaId>,
    ) -> Result<PreparedInterpretation, MediaError> {
        let id = id.into();
        let kernel = kernel.clone();
        let (record, observed) = session
            .transaction(move |c| {
                Box::pin(async move {
                    Ok::<_, MediaError>((
                        Self::read_in(c, id).await?,
                        Self::context_in(&kernel, c, id).await?,
                    ))
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
                    error @ (locus_file::FileError::Store(_) | locus_file::FileError::Database(_)),
                ) => return Err(error.into()),
                Err(error) => Err(AttemptFailure::new(FailureCode::FileAccess, error)),
                Ok(input) => match id.kind() {
                    MediaKind::Image => image_adapter::inspect(self, input).await.map(Facts::Image),
                    MediaKind::Video => video::inspect(self, input).await.map(Facts::Video),
                },
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
            .transaction(move |c| {
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
        sql_query(format!(
            "UPDATE {} SET revision = ?, payload = ? WHERE id = ?",
            record.id.kind().table()
        ))
        .bind::<BigInt, _>(record.revision)
        .bind::<Text, _>(record.payload()?)
        .bind::<Binary, _>(record.id.component().as_bytes().as_slice())
        .execute(context.connection())
        .await?;
        Ok(ApplyOutcome::Accepted(record))
    }
    pub async fn interpret(
        &self,
        kernel: &Kernel,
        files: &FileStorage,
        session: &mut Session,
        id: impl Into<MediaId>,
    ) -> Result<ApplyOutcome, MediaError> {
        let prepared = self.prepare(kernel, files, session, id).await?;
        self.apply(kernel, session, prepared).await
    }
}
