use super::Shared;
use crate::api::{
    error::ApiError,
    model::{
        dto::{ModelRecord, ModelView},
        mapping as map,
    },
    store,
};
use locus_model::api::ModelId;
use std::sync::Arc;
impl Shared {
    pub async fn model_read(self: &Arc<Self>, id: ModelId) -> Result<ModelRecord, ApiError> {
        let d = self.business()?.clone();
        self.query("Read Model", move |task| async move {
            let mut s = d.database.session(&task).await.map_err(store::failure)?;
            d.model
                .read(&mut s, id)
                .await
                .map(map::record)
                .map_err(|e| ApiError::domain(map::model(e)))
        })
        .await
    }
    pub async fn model_view(self: &Arc<Self>, id: ModelId) -> Result<ModelView, ApiError> {
        let d = self.business()?.clone();
        self.query("View Model", move |task| async move {
            let mut s = d.database.session(&task).await.map_err(store::failure)?;
            d.model
                .view(&d.kernel, &mut s, id)
                .await
                .map(map::view)
                .map_err(|e| ApiError::domain(map::model(e)))
        })
        .await
    }
}
