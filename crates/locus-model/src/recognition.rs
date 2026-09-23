use crate::{
    adapters,
    error::{AttemptFailure, FailureCode, ModelError},
    service::ModelService,
};
use locus_file::api::{FileId, FileService};
use locus_store::api::Session;
#[derive(Debug)]
pub enum RecognitionOutcome {
    Match,
    NoMatch,
    Failed(ModelError),
}
#[derive(Debug)]
pub struct Recognition {
    pub file: FileId,
    pub outcome: RecognitionOutcome,
}
impl ModelService {
    pub async fn recognize(
        &self,
        files: &FileService,
        session: &mut Session,
        file: FileId,
    ) -> Recognition {
        let result = async {
            let input = files.local_path(session, file).await?;
            self.task_work(
                session.task_context(),
                "Model recognition",
                move |service| async move {
                    service
                        .blocking(move || {
                            let extent = input
                                .handle()
                                .metadata()
                                .map_err(|e| AttemptFailure::new(FailureCode::FileAccess, e))?
                                .len();
                            Ok(adapters::recognize(&mut input.into_reader(), extent)?)
                        })
                        .await
                        .map_err(|e| AttemptFailure::new(FailureCode::Worker, e))?
                },
            )
            .await
        }
        .await;
        Recognition {
            file,
            outcome: match result {
                Ok(true) => RecognitionOutcome::Match,
                Ok(false) => RecognitionOutcome::NoMatch,
                Err(e) => RecognitionOutcome::Failed(e),
            },
        }
    }
}
