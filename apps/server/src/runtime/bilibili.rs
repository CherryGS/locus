use super::registry::Shared;
use crate::api::{
    bilibili::{dto::BilibiliView, mapping},
    error::{ApiError, DomainDiagnostic},
    store,
};
use std::sync::Arc;
impl Shared {
    pub async fn bilibili_view(
        self: &Arc<Self>,
        id: locus_bilibili::api::BilibiliId,
    ) -> Result<BilibiliView, ApiError> {
        let domain = self.business()?.clone();
        self.query("Read Bilibili capture", move |task| async move {
            let mut session = domain.database.session(&task).await.map_err(|e| {
                ApiError::domain(DomainDiagnostic::Store {
                    diagnostic: store::diagnostic(&e),
                })
            })?;
            domain
                .bilibili
                .view(&domain.kernel, &mut session, id)
                .await
                .map(mapping::view)
                .map_err(|e| {
                    ApiError::domain(DomainDiagnostic::Bilibili {
                        error: mapping::failure(e),
                    })
                })
        })
        .await
    }
}
