//! Provider dispatch owned by the registered-import consumer. Provider records
//! and their lifecycle remain in their independent domains.
use locus_bilibili::api as bilibili;
use locus_core::api::{ComponentId, Kernel, KindId};
use locus_file::api::FileId;
use locus_store::api::Context;
use locus_twitter::api as twitter;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SourceSnapshot {
    Twitter(twitter::TwitterSnapshot),
    Bilibili(bilibili::BilibiliSnapshot),
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum SourceId {
    Twitter(twitter::TwitterId),
    Bilibili(bilibili::BilibiliId),
}

pub(super) struct SourceRecord {
    pub snapshot: SourceSnapshot,
    pub revision: i64,
    pub basis: Option<FileId>,
}

impl SourceSnapshot {
    pub(super) async fn create_in(
        self,
        kernel: &Kernel,
        c: &mut Context,
    ) -> anyhow::Result<SourceId> {
        Ok(match self {
            Self::Twitter(snapshot) => {
                SourceId::Twitter(twitter::TwitterService::create_in(kernel, c, snapshot).await?)
            }
            Self::Bilibili(snapshot) => {
                SourceId::Bilibili(bilibili::BilibiliService::create_in(kernel, c, snapshot).await?)
            }
        })
    }
}

impl SourceId {
    pub(super) fn label(self) -> &'static str {
        match self {
            Self::Twitter(_) => "Twitter",
            Self::Bilibili(_) => "Bilibili",
        }
    }
    pub(crate) fn component(self) -> ComponentId {
        match self {
            Self::Twitter(id) => id.component(),
            Self::Bilibili(id) => id.component(),
        }
    }
    pub(crate) fn kind(self) -> KindId {
        match self {
            Self::Twitter(_) => twitter::TWITTER_KIND,
            Self::Bilibili(_) => bilibili::BILIBILI_KIND,
        }
    }
    pub(super) async fn read_in(self, c: &mut Context) -> anyhow::Result<SourceRecord> {
        Ok(match self {
            Self::Twitter(id) => {
                let record = twitter::TwitterService::read_in(c, id).await?;
                SourceRecord {
                    snapshot: SourceSnapshot::Twitter(record.snapshot),
                    revision: record.revision,
                    basis: record.basis,
                }
            }
            Self::Bilibili(id) => {
                let record = bilibili::BilibiliService::read_in(c, id).await?;
                SourceRecord {
                    snapshot: SourceSnapshot::Bilibili(record.snapshot),
                    revision: record.revision,
                    basis: record.basis,
                }
            }
        })
    }
    pub(super) async fn associate_in(
        self,
        kernel: &Kernel,
        c: &mut Context,
        file: FileId,
    ) -> anyhow::Result<i64> {
        match self {
            Self::Twitter(id) => {
                let prepared =
                    twitter::TwitterService::prepare_association_in(kernel, c, id, file).await?;
                match twitter::TwitterService::associate_in(kernel, c, prepared).await? {
                    twitter::WriteOutcome::Accepted(record) => Ok(record.revision),
                    _ => anyhow::bail!("Twitter association context changed"),
                }
            }
            Self::Bilibili(id) => {
                let prepared =
                    bilibili::BilibiliService::prepare_association_in(kernel, c, id, file).await?;
                match bilibili::BilibiliService::associate_in(kernel, c, prepared).await? {
                    bilibili::WriteOutcome::Accepted(record) => Ok(record.revision),
                    _ => anyhow::bail!("Bilibili association context changed"),
                }
            }
        }
    }
}
