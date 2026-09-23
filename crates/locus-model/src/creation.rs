use crate::{
    error::ModelError,
    identity::{MODEL_KIND, ModelId},
    persistence,
    record::ModelRecord,
    service::ModelService,
};
use locus_core::api::{ComponentId, Kernel};
use locus_store::api::{Context, Session};
impl ModelService {
    pub async fn create(
        &self,
        kernel: &Kernel,
        session: &mut Session,
    ) -> Result<ModelId, ModelError> {
        let kernel = kernel.clone();
        session
            .transaction(move |c| Box::pin(async move { Self::create_in(&kernel, c).await }))
            .await
    }
    /// Provisional until the caller commits its transaction.
    pub async fn create_in(kernel: &Kernel, context: &mut Context) -> Result<ModelId, ModelError> {
        let kernel = kernel.clone();
        context
            .savepoint(move |c| {
                Box::pin(async move {
                    let id = ModelId::from_component(ComponentId::new());
                    let record = ModelRecord {
                        id,
                        revision: 0,
                        basis: None,
                        facts: None,
                        last_failure: None,
                    };
                    persistence::insert(c, &record).await?;
                    kernel
                        .admit_component_in(c, MODEL_KIND, id.component())
                        .await?;
                    Ok(id)
                })
            })
            .await
    }
}
