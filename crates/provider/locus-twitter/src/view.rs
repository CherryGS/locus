use crate::{
    error::TwitterError,
    identity::{TWITTER_KIND, TwitterId},
    input::InputContext,
    record::TwitterRecord,
    service::TwitterService,
};
use locus_core::api::{EntityId, Kernel, Membership};
use locus_file::api::{CurrentInput, FileError, FileService, InputComparison, compare_input};
use locus_store::api::{Context, Session};

#[derive(Debug)]
pub enum TwitterApplicability {
    Unmounted,
    Input {
        host: EntityId,
        comparison: InputComparison,
        /// A metadata read error never erases the independently known comparison.
        /// None means no observed record error, not that bytes were probed.
        file_error: Option<FileError>,
    },
    Error(TwitterError),
}
#[derive(Debug)]
pub struct TwitterView {
    pub record: TwitterRecord,
    pub applicability: TwitterApplicability,
}
#[derive(Debug)]
pub struct TwitterEntry {
    pub membership: Membership,
    pub result: Result<TwitterView, TwitterError>,
}

impl TwitterService {
    pub async fn view(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        id: TwitterId,
    ) -> Result<TwitterView, TwitterError> {
        let kernel = kernel.clone();
        session
            .transaction(move |c| Box::pin(async move { Self::view_in(&kernel, c, id).await }))
            .await
    }
    pub async fn view_in(
        kernel: &Kernel,
        context: &mut Context,
        id: TwitterId,
    ) -> Result<TwitterView, TwitterError> {
        let record = Self::read_in(context, id).await?;
        let applicability = match Self::context_in(kernel, context, id).await {
            Ok(InputContext::Unmounted) => TwitterApplicability::Unmounted,
            Ok(InputContext::Hosted { host, input }) => {
                let file_error = match input {
                    CurrentInput::File(file) => FileService::read_in(context, file).await.err(),
                    _ => None,
                };
                TwitterApplicability::Input {
                    host,
                    comparison: compare_input(record.basis, Ok(input))?,
                    file_error,
                }
            }
            Err(error) => TwitterApplicability::Error(error),
        };
        Ok(TwitterView {
            record,
            applicability,
        })
    }
    /// No Twitter membership is None; a known missing/corrupt payload is Some(Err).
    pub async fn entity_view(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        entity: EntityId,
    ) -> Result<Option<TwitterEntry>, TwitterError> {
        let kernel = kernel.clone();
        session
            .transaction(move |c| {
                Box::pin(async move { Self::entity_view_in(&kernel, c, entity).await })
            })
            .await
    }
    pub async fn entity_view_in(
        kernel: &Kernel,
        context: &mut Context,
        entity: EntityId,
    ) -> Result<Option<TwitterEntry>, TwitterError> {
        let membership = kernel
            .memberships_in(context, entity)
            .await?
            .into_iter()
            .find(|m| m.kind == TWITTER_KIND);
        match membership {
            None => Ok(None),
            Some(membership) => Ok(Some(TwitterEntry {
                result: Self::view_in(
                    kernel,
                    context,
                    TwitterId::from_component(membership.component),
                )
                .await,
                membership,
            })),
        }
    }
}
