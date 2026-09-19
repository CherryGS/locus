use crate::{AttemptFailure, MediaError, MediaId, MediaKind, MediaStorage};
use diesel::{
    OptionalExtension, QueryableByName, sql_query,
    sql_types::{BigInt, Binary, Text},
};
use diesel_async::RunQueryDsl;
use locus_core::{EntityId, Kernel, Membership};
use locus_file::{
    CurrentInput, FileId, FileStorage, InputComparison, compare_input, observe_input_in,
};
use locus_store::{Context, Session};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImageFormat {
    Png,
    Jpeg,
    WebP,
    Gif,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImageFacts {
    pub format: ImageFormat,
    pub width: u32,
    pub height: u32,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DurationPrecision {
    Unknown,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StreamDuration {
    pub seconds: f64,
    pub precision: DurationPrecision,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VideoFacts {
    pub container: String,
    pub stream_index: u32,
    pub codec: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration: Option<StreamDuration>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Facts {
    Image(ImageFacts),
    Video(VideoFacts),
}
#[derive(Debug, Clone, PartialEq)]
pub struct MediaRecord {
    pub id: MediaId,
    pub revision: i64,
    pub basis: Option<FileId>,
    pub facts: Option<Facts>,
    pub last_failure: Option<AttemptFailure>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Payload {
    version: u32,
    basis: Option<[u8; 16]>,
    facts: Option<Facts>,
    last_failure: Option<AttemptFailure>,
}
#[derive(QueryableByName)]
struct Row {
    #[diesel(sql_type = Binary)]
    id: Vec<u8>,
    #[diesel(sql_type = BigInt)]
    revision: i64,
    #[diesel(sql_type = Text)]
    payload: String,
}
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
#[derive(Debug)]
pub enum Applicability {
    Unmounted,
    Input(InputComparison),
    /// Membership and File record lookup errors retain the Media record.
    Error(MediaError),
}
#[derive(Debug)]
pub struct MediaView {
    pub record: MediaRecord,
    pub applicability: Applicability,
}
#[derive(Debug)]
pub struct MediaEntry {
    pub membership: Membership,
    pub result: Result<MediaView, MediaError>,
}

impl MediaRecord {
    pub(crate) fn validate(&self) -> Result<(), MediaError> {
        let invalid =
            || MediaError::Corrupt(format!("invalid facts/basis/revision for {:?}", self.id));
        if self.revision < 0 || self.basis.is_some() != self.facts.is_some() {
            return Err(invalid());
        }
        match &self.facts {
            Some(Facts::Image(f))
                if self.id.kind() == MediaKind::Image && f.width > 0 && f.height > 0 => {}
            Some(Facts::Video(f)) if self.id.kind() == MediaKind::Video => {
                if !matches!(f.container.as_str(), "mov" | "matroska")
                    || f.codec
                        .as_ref()
                        .is_some_and(|v| v.is_empty() || v.len() > 128)
                    || f.width == Some(0)
                    || f.height == Some(0)
                    || f.duration.as_ref().is_some_and(|d| {
                        !d.seconds.is_finite() || d.seconds < 0.0 || d.seconds > 315_576_000.0
                    })
                {
                    return Err(invalid());
                }
            }
            None => (),
            _ => return Err(invalid()),
        }
        if self
            .last_failure
            .as_ref()
            .is_some_and(|f| f.detail.is_empty() || f.detail.chars().count() > 4096)
        {
            return Err(invalid());
        }
        Ok(())
    }
    pub(crate) fn payload(&self) -> Result<String, MediaError> {
        self.validate()?;
        serde_json::to_string(&Payload {
            version: 1,
            basis: self.basis.map(|v| *v.as_bytes()),
            facts: self.facts.clone(),
            last_failure: self.last_failure.clone(),
        })
        .map_err(|e| MediaError::Corrupt(e.to_string()))
    }
}
impl MediaStorage {
    pub async fn read(
        &self,
        session: &mut Session,
        id: impl Into<MediaId>,
    ) -> Result<MediaRecord, MediaError> {
        let id = id.into();
        session
            .transaction(move |c| Box::pin(Self::read_in(c, id)))
            .await
    }
    pub async fn read_in(context: &mut Context, id: MediaId) -> Result<MediaRecord, MediaError> {
        let row = sql_query(format!(
            "SELECT id, revision, payload FROM {} WHERE id = ?",
            id.kind().table()
        ))
        .bind::<Binary, _>(id.component().as_bytes().as_slice())
        .get_result::<Row>(context.connection())
        .await
        .optional()?
        .ok_or(MediaError::MissingRecord(id))?;
        if locus_core::ComponentId::from_bytes(&row.id)? != id.component() {
            return Err(MediaError::Corrupt("ID mismatch".into()));
        }
        let payload: Payload =
            serde_json::from_str(&row.payload).map_err(|e| MediaError::Corrupt(e.to_string()))?;
        if payload.version != 1 {
            return Err(MediaError::Corrupt("payload version".into()));
        }
        let record = MediaRecord {
            id,
            revision: row.revision,
            basis: payload.basis.map(|v| FileId::from_bytes(&v)).transpose()?,
            facts: payload.facts,
            last_failure: payload.last_failure,
        };
        record.validate()?;
        Ok(record)
    }
    pub(crate) async fn context_in(
        kernel: &Kernel,
        context: &mut Context,
        id: MediaId,
    ) -> Result<InputContext, MediaError> {
        let actual = kernel.component_kind_in(context, id.component()).await?;
        if actual != id.kind().kind() {
            return Err(locus_core::CoreError::KindMismatch {
                component: id.component(),
                actual,
                requested: id.kind().kind(),
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
    pub async fn view(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        id: impl Into<MediaId>,
    ) -> Result<MediaView, MediaError> {
        let id = id.into();
        let kernel = kernel.clone();
        session
            .transaction(move |c| Box::pin(async move { Self::view_in(&kernel, c, id).await }))
            .await
    }
    pub async fn view_in(
        kernel: &Kernel,
        context: &mut Context,
        id: MediaId,
    ) -> Result<MediaView, MediaError> {
        let record = Self::read_in(context, id).await?;
        let applicability = match Self::context_in(kernel, context, id).await {
            Ok(InputContext::Unmounted) => Applicability::Unmounted,
            Ok(InputContext::Hosted { input, .. }) => {
                let check = async {
                    if let CurrentInput::File(file) = input {
                        FileStorage::lookup_in(context, file).await?;
                    }
                    Ok::<_, MediaError>(compare_input(record.basis, Ok(input))?)
                }
                .await;
                match check {
                    Ok(comparison) => Applicability::Input(comparison),
                    Err(e) => Applicability::Error(e),
                }
            }
            Err(error) => Applicability::Error(error),
        };
        Ok(MediaView {
            record,
            applicability,
        })
    }
    pub async fn entity_view(
        &self,
        kernel: &Kernel,
        session: &mut Session,
        entity: EntityId,
    ) -> Result<Vec<MediaEntry>, MediaError> {
        let kernel = kernel.clone();
        session
            .transaction(move |c| {
                Box::pin(async move {
                    let memberships = kernel.memberships_in(c, entity).await?;
                    let mut entries = Vec::new();
                    for membership in memberships {
                        let kind = if membership.kind == crate::IMAGE_KIND {
                            MediaKind::Image
                        } else if membership.kind == crate::VIDEO_KIND {
                            MediaKind::Video
                        } else {
                            continue;
                        };
                        entries.push(MediaEntry {
                            membership,
                            result: Self::view_in(&kernel, c, kind.id(membership.component)).await,
                        });
                    }
                    Ok(entries)
                })
            })
            .await
    }
}
