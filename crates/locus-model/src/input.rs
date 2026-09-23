use crate::{error::ModelError, identity::ModelId, service::ModelService};
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

impl ModelService {
    pub(crate) async fn context_in(
        kernel: &Kernel,
        context: &mut Context,
        id: ModelId,
    ) -> Result<InputContext, ModelError> {
        let actual = kernel.component_kind_in(context, id.component()).await?;
        if actual != crate::identity::MODEL_KIND {
            return Err(locus_core::api::CoreError::KindMismatch {
                component: id.component(),
                actual,
                requested: crate::identity::MODEL_KIND,
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
    pub(crate) fn check(self, actual: InputContext) -> Result<(), ModelError> {
        if actual
            == (InputContext::Hosted {
                host: self.entity,
                input: CurrentInput::File(self.file),
            })
        {
            Ok(())
        } else {
            Err(ModelError::ContextChanged)
        }
    }
}
