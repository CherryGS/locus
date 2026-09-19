use super::prepared::{AdmissionFailure, PreparedFile};
use crate::{
    error::FileError, identity::FILE_KIND, persistence, record::FileRecord, service::FileService,
};
use locus_core::api::Kernel;
use locus_store::api::{Context, Session};
use std::{fs::File, path::Path};

impl FileService {
    /// Standalone convenience: successful copy followed by committed registration.
    /// Errors retain copy progress even when database commit completion is unknown.
    pub async fn admit(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        source: impl AsRef<Path>,
    ) -> Result<FileRecord, AdmissionFailure> {
        let prepared = self.prepare(source).await?;
        self.register(kernel, session, &prepared)
            .await
            .map_err(|source| AdmissionFailure {
                progress: Box::new(prepared.progress),
                source,
            })
    }

    /// Register a completed copy in a standalone committed unit. The caller keeps
    /// the prepared value on all errors, including StoreError::CommitOutcomeUnknown.
    pub async fn register(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        prepared: &PreparedFile,
    ) -> Result<FileRecord, FileError> {
        let storage = self.clone();
        let kernel = kernel.clone();
        let prepared = prepared.clone();
        session
            .transaction(move |context| {
                Box::pin(async move { storage.register_in(&kernel, context, &prepared).await })
            })
            .await
    }

    /// Provisional participant: both payload and core identity are protected by a
    /// savepoint even if the transaction owner catches this operation's error.
    /// The caller retains the prepared value for rollback/uncertain-commit inspection.
    pub async fn register_in(
        &self,
        kernel: &Kernel,
        context: &mut Context,
        prepared: &PreparedFile,
    ) -> Result<FileRecord, FileError> {
        if self.root != prepared.progress.root {
            return Err(FileError::WrongRoot);
        }
        let record = prepared.record();
        let storage = self.clone();
        let check_record = record.clone();
        tokio::task::spawn_blocking(move || -> Result<(), FileError> {
            let path = storage.record_path(&check_record)?;
            let file = File::open(path).map_err(|error| FileError::Access {
                id: check_record.id,
                cause: error.into(),
            })?;
            let metadata = file.metadata().map_err(|error| FileError::Access {
                id: check_record.id,
                cause: error.into(),
            })?;
            if !metadata.is_file() || metadata.len() != check_record.byte_count {
                return Err(FileError::PreparedCopyChanged(check_record.id));
            }
            Ok(())
        })
        .await
        .map_err(|error| FileError::Worker(error.to_string()))??;
        let kernel = kernel.clone();
        context
            .savepoint(move |context| {
                Box::pin(async move {
                    persistence::insert(context, &record).await?;
                    kernel
                        .admit_component_in(context, FILE_KIND, record.id.component())
                        .await?;
                    Ok(record)
                })
            })
            .await
    }
}
