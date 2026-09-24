use crate::{
    error::BilibiliError,
    identity::{BILIBILI_KIND, BilibiliId},
    input::InputContext,
    record::BilibiliRecord,
    service::BilibiliService,
};
use locus_core::api::{EntityId, Kernel, Membership};
use locus_file::api::{CurrentInput, FileError, FileService, InputComparison, compare_input};
use locus_store::api::{Context, Session};

#[derive(Debug)]
pub enum BilibiliApplicability {
    Unmounted,
    Input {
        host: EntityId,
        comparison: InputComparison,
        /// A metadata read error never erases the independently known comparison.
        /// None means no observed record error, not that bytes were probed.
        file_error: Option<FileError>,
    },
    Error(BilibiliError),
}
#[derive(Debug)]
pub enum CoverApplicability {
    Unassociated,
    Input {
        comparison: InputComparison,
        file_error: Option<FileError>,
    },
    Error(FileError),
}
#[derive(Debug)]
pub struct BilibiliView {
    pub record: BilibiliRecord,
    pub applicability: BilibiliApplicability,
    pub cover: CoverApplicability,
}
#[derive(Debug)]
pub struct BilibiliEntry {
    pub membership: Membership,
    pub result: Result<BilibiliView, BilibiliError>,
}

impl BilibiliService {
    pub async fn view(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        id: BilibiliId,
    ) -> Result<BilibiliView, BilibiliError> {
        let kernel = kernel.clone();
        session
            .transaction(move |c| Box::pin(async move { Self::view_in(&kernel, c, id).await }))
            .await
    }
    pub async fn view_in(
        kernel: &Kernel,
        context: &mut Context,
        id: BilibiliId,
    ) -> Result<BilibiliView, BilibiliError> {
        let record = Self::read_in(context, id).await?;
        let applicability = match Self::context_in(kernel, context, id).await {
            Ok(InputContext::Unmounted) => BilibiliApplicability::Unmounted,
            Ok(InputContext::Hosted { host, input }) => {
                let file_error = match input {
                    CurrentInput::File(file) => FileService::read_in(context, file).await.err(),
                    _ => None,
                };
                BilibiliApplicability::Input {
                    host,
                    comparison: compare_input(record.basis, Ok(input))?,
                    file_error,
                }
            }
            Err(error) => BilibiliApplicability::Error(error),
        };
        let cover = match record.original_cover {
            None => CoverApplicability::Unassociated,
            Some(target) => match locus_file::api::observe_input_in(kernel, context, target.entity)
                .await
            {
                Err(error) => CoverApplicability::Error(error),
                Ok(input) => {
                    let file_error = match input {
                        CurrentInput::File(file) => FileService::read_in(context, file).await.err(),
                        _ => None,
                    };
                    CoverApplicability::Input {
                        comparison: compare_input(Some(target.file), Ok(input))?,
                        file_error,
                    }
                }
            },
        };
        Ok(BilibiliView {
            record,
            applicability,
            cover,
        })
    }
    /// No Bilibili membership is None; a known missing/corrupt payload is Some(Err).
    pub async fn entity_view(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        entity: EntityId,
    ) -> Result<Option<BilibiliEntry>, BilibiliError> {
        let kernel = kernel.clone();
        session
            .transaction(move |c| {
                Box::pin(async move { Self::entity_view_in(&kernel, c, entity).await })
            })
            .await
    }
    pub async fn entity_view_in(
        kernel: &Kernel,
        context: &mut Context,
        entity: EntityId,
    ) -> Result<Option<BilibiliEntry>, BilibiliError> {
        let membership = kernel
            .memberships_in(context, entity)
            .await?
            .into_iter()
            .find(|m| m.kind == BILIBILI_KIND);
        match membership {
            None => Ok(None),
            Some(membership) => Ok(Some(BilibiliEntry {
                result: Self::view_in(
                    kernel,
                    context,
                    BilibiliId::from_component(membership.component),
                )
                .await,
                membership,
            })),
        }
    }
}
