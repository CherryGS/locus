use super::registry::Shared;
use crate::api::{
    error::{ApiError, DomainDiagnostic},
    store,
    twitter::{dto::TwitterView, mapping},
};
use std::sync::Arc;
impl Shared {
    pub async fn twitter_view(
        self: &Arc<Self>,
        id: locus_twitter::api::TwitterId,
    ) -> Result<TwitterView, ApiError> {
        let domain = self.domain.clone();
        self.query("Read Twitter capture", move |task| async move {
            let mut session = domain.database.session(&task).await.map_err(|e| {
                ApiError::domain(DomainDiagnostic::Store {
                    diagnostic: store::diagnostic(&e),
                })
            })?;
            domain
                .twitter
                .view(&domain.kernel, &mut session, id)
                .await
                .map(mapping::view)
                .map_err(|e| {
                    ApiError::domain(DomainDiagnostic::Twitter {
                        error: mapping::failure(e),
                    })
                })
        })
        .await
    }
}
