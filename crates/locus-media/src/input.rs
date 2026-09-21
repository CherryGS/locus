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

/// Original input prerequisite for a consumer-owned operation. This is a guard,
/// never a binding that bypasses actual memberships.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExpectedInput {
    pub entity: EntityId,
    pub file: FileId,
    /// When supplied, processing may only capture this component revision.
    pub revision: Option<i64>,
}
impl ExpectedInput {
    pub(crate) fn check(self, actual: InputContext) -> Result<(), MediaError> {
        if actual
            == (InputContext::Hosted {
                host: self.entity,
                input: CurrentInput::File(self.file),
            })
        {
            Ok(())
        } else {
            Err(MediaError::ContextChanged)
        }
    }
}
