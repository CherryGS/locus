use super::{registry::Shared, submissions::Arguments};
use crate::{
    access::persistence,
    api::{
        dto::MutationOutcome,
        error::{ApiError, ErrorCode},
        external::dto::{ResetToken, TokenObservation},
        task::dto::AccessContext,
    },
};
use std::sync::Arc;

#[derive(Clone)]
pub(crate) struct Authorization {
    pub epoch: u64,
    pub context_id: String,
}
impl Shared {
    pub fn external_authorize(&self, token: &str) -> Result<Authorization, ApiError> {
        let current = self.access.lock();
        let value = current.current.as_ref().ok_or_else(|| {
            ApiError::new(
                ErrorCode::Unauthorized,
                "External authorization unavailable",
            )
        })?;
        // Fixed-length comparison avoids prefix-dependent equality timing.
        let different = token.len() != value.token.len()
            || token
                .bytes()
                .zip(value.token.bytes())
                .fold(0, |n, (a, b)| n | (a ^ b))
                != 0;
        if different {
            return Err(ApiError::new(
                ErrorCode::Unauthorized,
                "Invalid external credential",
            ));
        }
        Ok(Authorization {
            epoch: current.epoch,
            context_id: value.context_id.clone(),
        })
    }
    pub fn external_current(&self, authorization: &Authorization) -> Result<(), ApiError> {
        let current = self.access.lock();
        if current.epoch != authorization.epoch
            || current
                .current
                .as_ref()
                .is_none_or(|c| c.context_id != authorization.context_id)
        {
            return Err(ApiError::new(
                ErrorCode::Unauthorized,
                "External credential is no longer current",
            ));
        }
        Ok(())
    }
    pub async fn token_read(self: &Arc<Self>) -> Result<TokenObservation, ApiError> {
        let state = self.clone();
        self.query("Read current external credential", move |task| async move {
            let _operation = state.access.operation.lock().await;
            let epoch = state.access.lock().epoch;
            let result = async {
                let mut session = state.library.database.session(&task).await?;
                session
                    .transaction_named("Observe retained external credential", |c| {
                        Box::pin(persistence::read(c))
                    })
                    .await
            }
            .await;
            // A reread that began before a replacement cannot supersede it.
            let registry = state.lock();
            if state.access.lock().epoch == epoch {
                state.access.establish(result);
            }
            let current = state.access.lock();
            let observation = match &current.current {
                Some(c) => TokenObservation::Current {
                    run_id: state.run_id.clone(),
                    context_id: c.context_id.clone(),
                    revision: c.revision.clone(),
                    token: c.token.clone(),
                },
                None => TokenObservation::Unavailable {
                    run_id: state.run_id.clone(),
                    message: current
                        .problem
                        .clone()
                        .unwrap_or_else(|| "Current credential unavailable".into()),
                },
            };
            drop(registry);
            Ok(observation)
        })
        .await
    }
    pub async fn token_reset(
        self: &Arc<Self>,
        request: ResetToken,
    ) -> Result<MutationOutcome, ApiError> {
        self.business()?;
        let state = self.clone();
        self.mutation(request.request_id,Arguments::ResetToken {expected_revision:request.expected_revision.clone()},"Reset shared external Token",move |task|async move {
            let _operation=state.access.operation.lock().await;
            #[cfg(test)]
            let fault=state.access.reset_fault.lock().unwrap().take();
            let result=async {
                let token=persistence::token()?;
                let revision=uuid::Uuid::now_v7().to_string();
                let mut session=state.library.database.session(&task).await?;
                session.transaction_named("Replace shared external credential",move |c|Box::pin(async move {
                    let value=persistence::replace(c,&request.expected_revision,token,revision).await?;
                    #[cfg(test)]
                    if matches!(fault,Some(crate::access::state::ResetFault::Rollback)) {anyhow::bail!("Injected credential rollback");}
                    Ok::<_,anyhow::Error>(value)
                })).await
            }.await;
            #[cfg(test)]
            if result.is_ok() && matches!(fault,Some(crate::access::state::ResetFault::PanicAfterCommit)) {panic!("Injected credential execution failure after commit");}
            #[cfg(test)]
            let result=if result.is_ok() && matches!(fault,Some(crate::access::state::ResetFault::Unknown)) {Err(locus_store::api::StoreError::CommitOutcomeUnknown(diesel::result::Error::RollbackTransaction).into())}else{result};
            let registry=state.lock();
            let outcome=match result {
                Ok(c)=>{let revision=c.revision.clone();state.access.establish(Ok(c));MutationOutcome::TokenReset{revision}},
                Err(error)=>{
                    let uncertain=error.downcast_ref::<locus_store::api::StoreError>().is_some_and(|e|matches!(e,locus_store::api::StoreError::CommitOutcomeUnknown(_)|locus_store::api::StoreError::RollbackFailed{..}));
                    if uncertain {state.access.establish(Err(error));}
                    MutationOutcome::TokenResetFailed {message:if uncertain {"Credential replacement is unconfirmed; reread current state after this operation ends"} else {"Credential replacement failed; reread current state before another explicit reset"}.into(),uncertain}
                }
            };
            drop(registry);
            outcome
        }).await
    }
    pub fn external_submission(&self, id: &str) -> Result<crate::api::dto::Submission, ApiError> {
        self.lock()
            .requests
            .get(&(AccessContext::External, id.to_owned()))
            .map(|b| b.result.clone())
            .ok_or_else(|| {
                ApiError::new(
                    ErrorCode::UnknownRequest,
                    "Unknown request in this external context and run",
                )
            })
    }
}
