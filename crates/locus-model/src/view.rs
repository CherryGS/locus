use crate::{
    error::ModelError, identity::ModelId, input::InputContext, record::ModelRecord,
    service::ModelService,
};
use locus_core::api::Kernel;
use locus_file::api::{CurrentInput, FileService, InputComparison, compare_input};
use locus_store::api::{Context, Session};
#[derive(Debug)]
pub struct ModelView {
    pub record: ModelRecord,
    pub context: Result<InputContext, ModelError>,
    pub comparison: Option<InputComparison>,
    pub file_problem: Option<locus_file::api::FileError>,
}
impl ModelService {
    pub async fn view(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        id: ModelId,
    ) -> Result<ModelView, ModelError> {
        let kernel = kernel.clone();
        session
            .transaction(move |c| Box::pin(async move { Self::view_in(&kernel, c, id).await }))
            .await
    }
    pub async fn view_in(
        kernel: &Kernel,
        c: &mut Context,
        id: ModelId,
    ) -> Result<ModelView, ModelError> {
        let record = Self::read_in(c, id).await?;
        let context = Self::context_in(kernel, c, id).await;
        let mut comparison = None;
        let mut file_problem = None;
        if let Ok(InputContext::Hosted { input, .. }) = &context {
            comparison = Some(compare_input(record.basis, Ok(*input))?);
            if let CurrentInput::File(file) = input {
                file_problem = FileService::read_in(c, *file).await.err();
            }
        }
        Ok(ModelView {
            record,
            context,
            comparison,
            file_problem,
        })
    }
}
