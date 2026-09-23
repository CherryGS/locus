use crate::{
    api::{
        dto::{Receipt, Submission, TaskOutcome},
        error::{ApiError, ErrorCode},
        external::dto::{RecoverUpload, UploadAction, UploadMetadata, UploadObservation},
        task::dto::AccessContext,
    },
    runtime::{
        Shared,
        external::Authorization,
        registry::Binding,
        submissions::{Arguments, check},
    },
};
use axum::body::Body;
use futures_util::StreamExt;
use locus_file::api::{FileService, PreparedFile};
use locus_task::api::TaskContext;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, MutexGuard},
};

#[derive(Default)]
pub(crate) struct Uploads {
    records: Mutex<BTreeMap<String, Upload>>,
    #[cfg(test)]
    pub registration_fault: Mutex<Option<UploadFault>>,
    #[cfg(test)]
    pub preparation_failure: Mutex<bool>,
    #[cfg(test)]
    pub pause_acceptance: Mutex<Option<(Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>)>>,
    #[cfg(test)]
    pub pause_admission: Mutex<Option<(Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>)>>,
    #[cfg(test)]
    pub pause_writer: Mutex<Option<(Arc<tokio::sync::Notify>, std::sync::mpsc::Receiver<()>)>>,
}
#[cfg(test)]
#[derive(Clone, Copy)]
pub(crate) enum UploadFault {
    Rollback,
    Unknown,
    Panic,
}
struct Upload {
    digest: Option<[u8; 32]>,
    input: Option<Arc<tempfile::TempPath>>,
    prepared: Option<PreparedFile>,
    observation: UploadObservation,
}
impl Uploads {
    fn lock(&self) -> MutexGuard<'_, BTreeMap<String, Upload>> {
        self.records.lock().unwrap_or_else(|e| e.into_inner())
    }
    pub(crate) fn reserve_recovery(&self, request: &RecoverUpload) -> Result<(), ApiError> {
        let mut uploads = self.lock();
        let upload = uploads
            .get_mut(&request.upload_id)
            .ok_or_else(|| ApiError::invalid("Unknown upload in this external context"))?;
        if upload.observation.active_request_id.is_some()
            || !upload.observation.actions.contains(&request.action)
        {
            return Err(ApiError::new(
                ErrorCode::RequestConflict,
                "Observe the original upload before creating recovery work",
            ));
        }
        upload.observation.active_request_id = Some(request.request_id.clone());
        Ok(())
    }
    pub(crate) fn release(&self, request: &RecoverUpload) {
        if let Some(upload) = self.lock().get_mut(&request.upload_id) {
            upload.observation.active_request_id = None;
        }
    }
    pub(crate) fn end_unfinished(&self, id: &str, request: &str) {
        if let Some(upload) = self.lock().get_mut(id)
            && upload.observation.active_request_id.as_deref() == Some(request)
        {
            upload.observation.active_request_id = None;
            upload.observation.problem=Some("Execution ended without its complete operation result; retained effects require observation".into());
            upload.observation.actions = if upload.observation.confirmed_file_id.is_some() {
                vec![]
            } else if upload.observation.uncertain {
                vec![UploadAction::Confirm]
            } else if upload.prepared.is_some() {
                vec![UploadAction::Retry]
            } else {
                vec![UploadAction::Recopy]
            };
        }
    }
}
fn failure(message: impl Into<String>) -> ApiError {
    ApiError::new(ErrorCode::OperationFailed, message)
}
impl Shared {
    pub fn upload_observation(&self, id: &str) -> Result<UploadObservation, ApiError> {
        self.uploads
            .lock()
            .get(id)
            .map(|u| u.observation.clone())
            .ok_or_else(|| {
                ApiError::new(
                    ErrorCode::UnknownRequest,
                    "Unknown upload in this external context and run",
                )
            })
    }
    pub async fn receive_upload(
        self: &Arc<Self>,
        basis: Authorization,
        metadata: UploadMetadata,
        body: Body,
    ) -> Result<Submission, ApiError> {
        let declared = metadata
            .byte_count
            .parse::<u64>()
            .ok()
            .filter(|v| v.to_string() == metadata.byte_count && *v <= i64::MAX as u64)
            .ok_or_else(|| {
                ApiError::invalid("byte_count must be an exact nonnegative decimal integer")
            })?;
        if metadata.filename.as_ref().is_some_and(|v| v.contains('\0')) {
            return Err(ApiError::invalid("Invalid display filename"));
        }
        let original = {
            let mut registry = self.lock();
            let key = (AccessContext::External, metadata.request_id.clone());
            let original = if let Some(binding) = registry.requests.get(&key) {
                check(binding, &Arguments::Upload(metadata.clone()))?;
                // Looking up the original remains available during drain, but
                // another byte delivery still starts a new receiver lifetime.
                self.external_current(&basis)?;
                self.admit(&mut registry)?;
                false
            } else {
                self.external_current(&basis)?;
                self.admit(&mut registry)?;
                self.business()?;
                registry.requests.insert(
                    key,
                    Binding {
                        arguments: Arguments::Upload(metadata.clone()),
                        result: Submission::AdmissionPending,
                    },
                );
                self.uploads.lock().insert(
                    metadata.request_id.clone(),
                    Upload {
                        digest: None,
                        input: None,
                        prepared: None,
                        observation: UploadObservation {
                            upload_id: metadata.request_id.clone(),
                            filename: metadata.filename.clone(),
                            byte_count: metadata.byte_count.clone(),
                            receiving: true,
                            active_request_id: None,
                            confirmed_file_id: None,
                            candidate_file_id: None,
                            uncertain: false,
                            problem: None,
                            actions: vec![],
                            copied_bytes: None,
                            copy_complete: false,
                            managed_bytes_may_exist: false,
                        },
                    },
                );
                true
            };
            registry.receivers += 1;
            original
        };
        // A supervisor owns network reads and actual buffer writes even if the
        // response consumer disappears. Receiving remains separate from accepted work.
        let state = self.clone();
        let id = metadata.request_id.clone();
        let (sender, receiver) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let worker = state.clone();
            let worker_basis = basis.clone();
            let launched = state
                .queue
                .submit("Receive external input", move |task| async move {
                    receive(&worker, &worker_basis, &task, declared, body, original).await
                });
            let received = match launched {
                Ok(handle) => handle
                    .result()
                    .await
                    .map_err(|_| failure("Upload receiver failed"))
                    .and_then(|v| v),
                Err(_) => Err(failure("Upload receiver could not start")),
            };
            let result = match received {
                Ok((path, digest)) => {
                    if original {
                        if let Some(upload) = state.uploads.lock().get_mut(&id) {
                            upload.digest = Some(digest);
                            upload.input = path;
                            upload.observation.receiving = false;
                            upload.observation.active_request_id = Some(id.clone());
                        }
                        let work = state.clone();
                        let operation_id = id.clone();
                        let context = basis.context_id.clone();
                        #[cfg(test)]
                        {
                            let pause = state.uploads.pause_acceptance.lock().unwrap().take();
                            if let Some((entered, release)) = pause {
                                entered.notify_one();
                                release.notified().await;
                            }
                        }
                        state
                            .public_claimed(
                                crate::runtime::submissions::Admission {
                                    context: AccessContext::External,
                                    authorization: Some(basis),
                                    batch: None,
                                },
                                id.clone(),
                                Arguments::Upload(metadata),
                                "Admit uploaded File",
                                None,
                                move |task| async move {
                                    work.execute_upload(
                                        &task,
                                        &operation_id,
                                        &context,
                                        UploadAction::Recopy,
                                    )
                                    .await
                                },
                            )
                            .map(|receipt| Submission::Accepted { receipt })
                    } else {
                        let mut changes = state.changes.subscribe();
                        let mut stopping = state.stopping.subscribe();
                        loop {
                            if let Err(error) = state.external_current(&basis) {
                                break Err(error);
                            }
                            let established = state.uploads.lock().get(&id).and_then(|u| u.digest);
                            if let Some(established) = established {
                                break if established == digest {
                                    state.external_submission(&id)
                                } else {
                                    Err(ApiError::new(
                                        ErrorCode::RequestConflict,
                                        "Upload bytes differ from the original request",
                                    ))
                                };
                            }
                            match state.external_submission(&id) {
                                Ok(Submission::Rejected { error }) => break Err(error),
                                Err(error) => break Err(error),
                                _ => (),
                            }
                            tokio::select! {r=changes.changed()=>if r.is_err(){break Err(failure("Upload observation ended"));},_=stopping.changed()=>break Err(failure("Receiving stopped for shutdown"))}
                        }
                    }
                }
                Err(error) => Err(error),
            };
            let mut registry = state.lock();
            if original && let Err(error) = &result {
                if let Some(binding) = registry
                    .requests
                    .get_mut(&(AccessContext::External, id.clone()))
                {
                    binding.result = Submission::Rejected {
                        error: error.clone(),
                    };
                }
                if let Some(upload) = state.uploads.lock().get_mut(&id) {
                    upload.observation.receiving = false;
                    upload.observation.active_request_id = None;
                    upload.observation.problem = Some(error.message.clone());
                }
            }
            registry.receivers -= 1;
            state.changed(&mut registry);
            if !registry.open && registry.active == 0 && registry.receivers == 0 {
                state.drained.send_replace(true);
            }
            drop(registry);
            let _ = sender.send(result);
        });
        receiver
            .await
            .map_err(|_| failure("Upload supervisor unavailable"))?
    }
    pub fn recover_upload(
        self: &Arc<Self>,
        basis: Authorization,
        request: RecoverUpload,
    ) -> Result<Receipt, ApiError> {
        // Original binding wins even if recovery eligibility subsequently changes.
        if let Some(binding) = self
            .lock()
            .requests
            .get(&(AccessContext::External, request.request_id.clone()))
        {
            check(binding, &Arguments::RecoverUpload(request.clone()))?;
            return match &binding.result {
                Submission::Accepted { receipt } => Ok(receipt.clone()),
                Submission::Rejected { error } => Err(error.clone()),
                _ => Err(failure("Recovery admission pending")),
            };
        }
        let worker = self.clone();
        let operation = request.clone();
        let context = basis.context_id.clone();

        self.public_claimed(
            crate::runtime::submissions::Admission {
                context: AccessContext::External,
                authorization: Some(basis),
                batch: None,
            },
            request.request_id.clone(),
            Arguments::RecoverUpload(request.clone()),
            "Recover uploaded File",
            None,
            move |task| async move {
                worker
                    .execute_upload(&task, &operation.upload_id, &context, operation.action)
                    .await
            },
        )
    }
    async fn execute_upload(
        self: &Arc<Self>,
        task: &TaskContext,
        id: &str,
        context: &str,
        action: UploadAction,
    ) -> TaskOutcome {
        let result = self.upload_work(task, id, context, action).await;
        let mut uploads = self.uploads.lock();
        let Some(upload) = uploads.get_mut(id) else {
            return TaskOutcome::Upload {
                result: Box::new(UploadObservation {
                    upload_id: id.into(),
                    filename: None,
                    byte_count: "0".into(),
                    receiving: false,
                    active_request_id: None,
                    confirmed_file_id: None,
                    candidate_file_id: None,
                    uncertain: true,
                    problem: Some("Upload context unavailable".into()),
                    actions: vec![],
                    copied_bytes: None,
                    copy_complete: false,
                    managed_bytes_may_exist: false,
                }),
            };
        };
        upload.observation.active_request_id = None;
        if let Err(error) = result {
            upload.observation.problem = Some(error.to_string());
        }
        upload.observation.actions = if upload.observation.confirmed_file_id.is_some() {
            vec![]
        } else if upload.observation.uncertain {
            vec![UploadAction::Confirm]
        } else if upload.prepared.is_some() {
            vec![UploadAction::Retry]
        } else {
            vec![UploadAction::Recopy]
        };
        TaskOutcome::Upload {
            result: Box::new(upload.observation.clone()),
        }
    }
    async fn upload_work(
        &self,
        task: &TaskContext,
        id: &str,
        context: &str,
        action: UploadAction,
    ) -> anyhow::Result<()> {
        let domain = self
            .business()
            .map_err(|e| anyhow::anyhow!(e.message))?
            .clone();
        #[cfg(test)]
        {
            let pause = self.uploads.pause_admission.lock().unwrap().take();
            if let Some((entered, release)) = pause {
                entered.notify_one();
                release.notified().await;
            }
        }
        let (input, prepared) = {
            let uploads = self.uploads.lock();
            let upload = uploads
                .get(id)
                .ok_or_else(|| anyhow::anyhow!("Upload context unavailable"))?;
            (upload.input.clone(), upload.prepared.clone())
        };
        if action == UploadAction::Confirm {
            let prepared = prepared.ok_or_else(|| {
                anyhow::anyhow!("Original preparation unavailable; completion remains unconfirmed")
            })?;
            let file = prepared.id();
            let context = context.to_owned();
            let mut session = domain.database.session(task).await?;
            session
                .transaction_named("Confirm uploaded File and eligibility", move |c| {
                    Box::pin(async move {
                        let record = FileService::read_in(c, file).await?;
                        anyhow::ensure!(
                            record.byte_count == prepared.progress().bytes_written
                                && record.relative_path == prepared.progress().relative_path,
                            "Uploaded File context changed"
                        );
                        anyhow::ensure!(
                            super::persistence::eligible(c, &context, file).await?,
                            "Uploaded File eligibility is unconfirmed"
                        );
                        Ok::<_, anyhow::Error>(())
                    })
                })
                .await?;
            if let Some(upload) = self.uploads.lock().get_mut(id) {
                upload.observation.confirmed_file_id = Some(file.to_string());
                upload.observation.uncertain = false;
                upload.observation.problem = None;
            }
            return Ok(());
        }
        let prepared = if action == UploadAction::Recopy {
            let input = input.ok_or_else(|| {
                anyhow::anyhow!(
                    "Received input unavailable; intentionally deliver a new complete upload"
                )
            })?;
            #[cfg(test)]
            let missing = std::mem::take(&mut *self.uploads.preparation_failure.lock().unwrap());
            #[cfg(not(test))]
            let missing = false;
            let source = if missing {
                input.with_extension("missing-test-input")
            } else {
                input.to_path_buf()
            };
            let result = domain.files.prepare_task(task, source).await;
            if let Some(upload) = self.uploads.lock().get_mut(id) {
                let progress = match &result {
                    Ok(prepared) => prepared.progress(),
                    Err(error) => &error.progress,
                };
                upload.observation.candidate_file_id = Some(progress.id.to_string());
                upload.observation.copied_bytes = Some(progress.bytes_written.to_string());
                upload.observation.copy_complete = progress.copy_complete;
                upload.observation.managed_bytes_may_exist = progress.managed_bytes_may_exist;
            }
            let prepared = result?;
            if let Some(upload) = self.uploads.lock().get_mut(id) {
                upload.prepared = Some(prepared.clone());
            }
            prepared
        } else {
            prepared.ok_or_else(|| {
                anyhow::anyhow!(
                    "Original completed preparation is unavailable; explicit full copy is required"
                )
            })?
        };
        let file = prepared.id();
        let context = context.to_owned();
        let mut session = domain.database.session(task).await?;
        // Mark uncertain before the actual unit; only a definite return may lower
        // that state. An executor failure cannot turn a potentially committed unit
        // into permission to create another File.
        if let Some(upload) = self.uploads.lock().get_mut(id) {
            upload.observation.uncertain = true;
        }
        #[cfg(test)]
        let fault = self.uploads.registration_fault.lock().unwrap().take();
        #[cfg(test)]
        if matches!(fault, Some(UploadFault::Panic)) {
            panic!("Injected upload executor failure");
        }
        let result = session
            .transaction_named(
                "Register uploaded File and external eligibility",
                move |c| {
                    Box::pin(async move {
                        domain
                            .files
                            .register_in(&domain.kernel, c, &prepared)
                            .await?;
                        super::persistence::admit(c, &context, file).await?;
                        #[cfg(test)]
                        if matches!(fault, Some(UploadFault::Rollback)) {
                            anyhow::bail!("Injected registration rollback");
                        }
                        Ok::<_, anyhow::Error>(())
                    })
                },
            )
            .await;
        #[cfg(test)]
        let result = if result.is_ok() && matches!(fault, Some(UploadFault::Unknown)) {
            Err(locus_store::api::StoreError::CommitOutcomeUnknown(
                diesel::result::Error::RollbackTransaction,
            )
            .into())
        } else {
            result
        };
        if let Some(upload) = self.uploads.lock().get_mut(id) {
            match &result {
                Ok(()) => {
                    upload.observation.confirmed_file_id = Some(file.to_string());
                    upload.observation.uncertain = false;
                    upload.observation.problem = None;
                }
                Err(error) => {
                    upload.observation.uncertain = error
                        .downcast_ref::<locus_store::api::StoreError>()
                        .is_some_and(|e| {
                            matches!(
                                e,
                                locus_store::api::StoreError::CommitOutcomeUnknown(_)
                                    | locus_store::api::StoreError::RollbackFailed { .. }
                            )
                        });
                    if !upload.observation.uncertain
                        && matches!(
                            error.downcast_ref::<locus_file::api::FileError>(),
                            Some(
                                locus_file::api::FileError::PreparedCopyChanged(_)
                                    | locus_file::api::FileError::Access { .. }
                            )
                        )
                    {
                        upload.prepared = None;
                    }
                }
            }
        }
        result
    }
}

async fn receive(
    state: &Shared,
    basis: &Authorization,
    task: &TaskContext,
    declared: u64,
    body: Body,
    retain: bool,
) -> Result<(Option<Arc<tempfile::TempPath>>, [u8; 32]), ApiError> {
    let mut credential = state.access.changed.subscribe();
    let mut stopping = state.stopping.subscribe();
    let (mut file, path) = if retain {
        let (file, path) = tempfile::NamedTempFile::new()
            .map_err(|_| failure("Could not create upload buffer"))?
            .into_parts();
        (Some(file), Some(Arc::new(path)))
    } else {
        (None, None)
    };
    let mut stream = body.into_data_stream();
    let mut count = 0_u64;
    let mut hash = Sha256::new();
    let result=async {
        loop {
            state.external_current(basis)?;
            if *stopping.borrow() {return Err(failure("Receiving stopped for shutdown"));}
            let chunk=tokio::select! {biased;_=credential.changed()=>return Err(ApiError::new(ErrorCode::Unauthorized,"Credential changed while receiving")),_=stopping.changed()=>return Err(failure("Receiving stopped for shutdown")),chunk=stream.next()=>chunk};
            let Some(chunk)=chunk else {break};let chunk=chunk.map_err(|_|ApiError::invalid("Upload body ended incompletely"))?;
            count=count.checked_add(chunk.len() as u64).ok_or_else(||ApiError::invalid("Upload size overflow"))?;
            if count>declared {return Err(ApiError::invalid("Upload exceeds declared byte count"));}
            hash.update(&chunk);
            // Do not select/cancel a protected writer. Await flush below even if
            // reset/exit stops subsequent network reads.
            if let Some(mut output)=file.take() {
                let stage=task.enter("Receive upload bytes",&[]).await.map_err(|_|failure("Could not enter receiving stage"))?;
                #[cfg(test)]
                let pause=state.uploads.pause_writer.lock().unwrap().take();
                let retained=path.clone();
                let (output,written)=stage.spawn_blocking(move |_| {
                    let _retained=retained;
                    let result=output.write_all(&chunk);
                    #[cfg(test)]
                    if let Some((entered,release))=pause {entered.notify_one();let _=release.recv();}
                    (output,result)
                }).await.map_err(|_|failure("Upload buffer writer failed"))?;
                file=Some(output);written.map_err(|_|failure("Could not write upload buffer"))?;
            }
        }
        if count!=declared {return Err(ApiError::invalid("Upload ended before its declared byte count"));}
        Ok(())
    }.await;
    if let Some(mut output) = file.take() {
        let stage = task
            .enter("Finish received upload buffer", &[])
            .await
            .map_err(|_| failure("Could not finish receiving stage"))?;
        let retained = path.clone();
        stage
            .spawn_blocking(move |_| {
                let _retained = retained;
                output.flush()
            })
            .await
            .map_err(|_| failure("Upload flush worker failed"))?
            .map_err(|_| failure("Could not finish upload buffer writes"))?;
    }
    drop(file);
    result?;
    Ok((path, hash.finalize().into()))
}
