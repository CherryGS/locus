use crate::{error::MediaError, identity::MediaId, service::MediaService};
use locus_core::api::{EntityId, Kernel};
use locus_file::api::{CurrentInput, FileId, observe_input_in};
use locus_store::api::Context;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputContext {
    Unmounted,
    Hosted { host: EntityId, input: CurrentInput },
}
impl InputContext {
    pub(crate) fn file(self) -> Option<FileId> {
        match self {
            Self::Hosted {
                input: CurrentInput::File(id),
                ..
            } => Some(id),
            _ => None,
        }
    }
}

impl MediaService {
    pub(crate) async fn context_in(
        kernel: &Kernel,
        context: &mut Context,
        id: MediaId,
    ) -> Result<InputContext, MediaError> {
        let actual = kernel.component_kind_in(context, id.component()).await?;
        if actual != id.kind().kind() {
            return Err(locus_core::api::CoreError::KindMismatch {
                component: id.component(),
                actual,
                requested: id.kind().kind(),
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
