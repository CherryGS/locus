use crate::{
    error::TwitterError,
    identity::{TWITTER_KIND, TwitterId},
    service::TwitterService,
};
use locus_core::api::{CoreError, EntityId, Kernel};
use locus_file::api::{CurrentInput, observe_input_in};
use locus_store::api::Context;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InputContext {
    Unmounted,
    Hosted { host: EntityId, input: CurrentInput },
}
impl TwitterService {
    pub(crate) async fn context_in(
        kernel: &Kernel,
        context: &mut Context,
        id: TwitterId,
    ) -> Result<InputContext, TwitterError> {
        let actual = kernel.component_kind_in(context, id.component()).await?;
        if actual != TWITTER_KIND {
            return Err(CoreError::KindMismatch {
                component: id.component(),
                actual,
                requested: TWITTER_KIND,
            }
            .into());
        }
        match kernel.attachment_in(context, id.component()).await? {
            None => Ok(InputContext::Unmounted),
            Some(membership) => Ok(InputContext::Hosted {
                host: membership.entity,
                input: observe_input_in(kernel, context, membership.entity).await?,
            }),
        }
    }
}
