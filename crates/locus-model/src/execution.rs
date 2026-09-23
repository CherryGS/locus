use crate::{error::ModelError, service::ModelService};
use locus_task::api::TaskContext;
use std::future::Future;

impl ModelService {
    pub(crate) async fn task_work<T, F, Fut>(
        &self,
        task: Option<&TaskContext>,
        label: &'static str,
        operation: F,
    ) -> Result<T, ModelError>
    where
        T: Send + 'static,
        F: FnOnce(Self) -> Fut + Send + 'static,
        Fut: Future<Output = Result<T, ModelError>> + Send + 'static,
    {
        let mut storage = self.clone();
        match task {
            Some(task) => {
                task.run(label, &[], move |stage| async move {
                    stage.progress(None, None, label);
                    storage.stage = Some(stage);
                    operation(storage).await
                })
                .await?
            }
            None => operation(storage).await,
        }
    }

    pub(crate) fn blocking<T, F>(&self, operation: F) -> tokio::task::JoinHandle<T>
    where
        T: Send + 'static,
        F: FnOnce() -> T + Send + 'static,
    {
        match &self.stage {
            Some(stage) => stage.spawn_blocking(move |_| operation()),
            None => tokio::task::spawn_blocking(operation),
        }
    }
}
