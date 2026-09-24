use crate::{
    error::CivitaiError,
    examples::{ExampleBinding, validate_binding_in},
    identity::{CIVITAI_KIND, CivitaiId},
    persistence,
    record::CivitaiRecord,
    service::CivitaiService,
    snapshot::ModelVersion,
};
use locus_core::api::{EntityId, Kernel};
use locus_file::api::{CurrentInput, FileService, observe_input_in};
use locus_store::api::{Context, Session};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InputStatus {
    Current,
    Changed,
    Missing,
    Unmounted,
    Failed(String),
}
#[derive(Debug, Clone)]
pub struct CivitaiView {
    pub record: CivitaiRecord,
    pub host: Option<EntityId>,
    pub input: InputStatus,
}
#[derive(Debug, Clone)]
pub struct SourceReference {
    pub component: CivitaiId,
    pub entity: EntityId,
    pub observation: String,
    pub revision: i64,
}
#[derive(Debug, Clone)]
pub struct Correspondence {
    pub source: SourceReference,
    pub version: u64,
    pub file: u64,
    pub basis: locus_file::api::FileId,
    pub input: InputStatus,
    pub blake3: String,
}
#[derive(Debug, Clone)]
pub struct VersionDirectoryEntry {
    pub id: u64,
    pub in_origin: bool,
    pub sources: Vec<SourceReference>,
}
#[derive(Debug, Clone)]
pub struct Page {
    pub origin: CivitaiView,
    pub versions: Vec<VersionDirectoryEntry>,
    pub correspondences: Vec<Correspondence>,
}
#[derive(Debug, Clone)]
pub struct ManagedExample {
    pub source: SourceReference,
    pub binding: ExampleBinding,
    pub applicable: bool,
    pub problem: Option<String>,
}
#[derive(Debug, Clone)]
pub struct VersionView {
    pub model: u64,
    pub source: SourceReference,
    pub in_origin: bool,
    pub version: ModelVersion,
    pub correspondences: Vec<Correspondence>,
    pub examples: Vec<ManagedExample>,
}

impl CivitaiService {
    pub async fn view(
        &self,
        k: &Kernel,
        s: &mut Session,
        id: CivitaiId,
    ) -> Result<CivitaiView, CivitaiError> {
        let k = k.clone();
        s.transaction(move |c| Box::pin(Self::view_in(k, c, id)))
            .await
    }
    async fn view_in(
        k: Kernel,
        c: &mut Context,
        id: CivitaiId,
    ) -> Result<CivitaiView, CivitaiError> {
        let record = Self::read_in(c, id).await?;
        let attachment = k.attachment_in(c, id.component()).await?;
        let host = attachment.map(|m| m.entity);
        let input = match attachment {
            None => InputStatus::Unmounted,
            Some(member) => {
                if member.kind != CIVITAI_KIND {
                    return Err(CivitaiError::Conflict);
                }
                let observed: Result<_, CivitaiError> = async {
                    Ok(match observe_input_in(&k, c, member.entity).await? {
                        CurrentInput::File(file) => {
                            FileService::read_in(c, file).await?;
                            if file == record.basis {
                                InputStatus::Current
                            } else {
                                InputStatus::Changed
                            }
                        }
                        _ => InputStatus::Missing,
                    })
                }
                .await;
                observed.unwrap_or_else(|e| InputStatus::Failed(e.to_string()))
            }
        };
        Ok(CivitaiView {
            record,
            host,
            input,
        })
    }
    pub async fn entity_view(
        &self,
        k: &Kernel,
        s: &mut Session,
        entity: EntityId,
    ) -> Result<Option<CivitaiView>, CivitaiError> {
        let k = k.clone();
        s.transaction(move |c| {
            Box::pin(async move {
                match k
                    .memberships_in(c, entity)
                    .await?
                    .into_iter()
                    .find(|m| m.kind == CIVITAI_KIND)
                {
                    Some(m) => Self::view_in(k, c, CivitaiId::from_component(m.component))
                        .await
                        .map(Some),
                    None => Ok(None),
                }
            })
        })
        .await
    }
    pub async fn page(
        &self,
        k: &Kernel,
        s: &mut Session,
        origin: CivitaiId,
    ) -> Result<Page, CivitaiError> {
        let k = k.clone();
        s.transaction_named("Read origin-owned Civitai Page", move |c| {
            Box::pin(Self::page_in(k, c, origin))
        })
        .await
    }
    async fn page_in(k: Kernel, c: &mut Context, origin: CivitaiId) -> Result<Page, CivitaiError> {
        let origin = Self::view_in(k.clone(), c, origin).await?;
        if origin.host.is_none() {
            return Err(CivitaiError::Conflict);
        }
        let mut versions: Vec<_> = origin
            .record
            .snapshot
            .model
            .model_versions
            .iter()
            .map(|v| VersionDirectoryEntry {
                id: v.id,
                in_origin: true,
                sources: Vec::new(),
            })
            .collect();
        let mut correspondences = Vec::new();
        for id in persistence::model_ids(c, origin.record.snapshot.model.id).await? {
            let Some(member) = k.attachment_in(c, id.component()).await? else {
                continue;
            };
            if member.kind != CIVITAI_KIND {
                return Err(CivitaiError::Conflict);
            }
            let record = Self::read_in(c, id).await?;
            let view = Self::view_in(k.clone(), c, record.id).await?;
            let source = SourceReference {
                component: record.id,
                entity: member.entity,
                observation: record.observation.clone(),
                revision: record.revision,
            };
            let version = record.snapshot.matched_version;
            if let Some(entry) = versions.iter_mut().find(|v| v.id == version) {
                entry.sources.push(source.clone());
            } else {
                versions.push(VersionDirectoryEntry {
                    id: version,
                    in_origin: false,
                    sources: vec![source.clone()],
                });
            }
            correspondences.push(Correspondence {
                source,
                version,
                file: record.snapshot.matched_file,
                basis: record.basis,
                input: view.input,
                blake3: record.snapshot.blake3,
            });
        }
        Ok(Page {
            origin,
            versions,
            correspondences,
        })
    }
    /// A source is a whole version unit. Own versions always take precedence;
    /// an absent-origin version with several sources requires an explicit identity.
    pub async fn version(
        &self,
        k: &Kernel,
        s: &mut Session,
        origin: CivitaiId,
        version: u64,
        source: Option<CivitaiId>,
    ) -> Result<VersionView, CivitaiError> {
        let k = k.clone();
        s.transaction_named("Read selected Civitai version source", move |c| {
            Box::pin(async move {
                let page = Self::page_in(k.clone(), c, origin).await?;
                let directory = page
                    .versions
                    .iter()
                    .find(|v| v.id == version)
                    .ok_or(CivitaiError::Conflict)?;
                let chosen = if directory.in_origin {
                    origin
                } else {
                    match source {
                        Some(id) if directory.sources.iter().any(|s| s.component == id) => id,
                        None if directory.sources.len() == 1 => directory.sources[0].component,
                        _ => {
                            return Err(CivitaiError::Invalid(
                                "Select an eligible source for this version".into(),
                            ));
                        }
                    }
                };
                let record = Self::read_in(c, chosen).await?;
                let member = k
                    .attachment_in(c, chosen.component())
                    .await?
                    .ok_or(CivitaiError::Conflict)?;
                let unit = record
                    .snapshot
                    .model
                    .model_versions
                    .iter()
                    .find(|v| v.id == version)
                    .ok_or(CivitaiError::Conflict)?
                    .clone();
                let source = SourceReference {
                    component: chosen,
                    entity: member.entity,
                    observation: record.observation,
                    revision: record.revision,
                };
                let correspondences: Vec<_> = page
                    .correspondences
                    .into_iter()
                    .filter(|c| c.version == version)
                    .collect();
                let mut examples = Vec::new();
                for peer in &correspondences {
                    let record = Self::read_in(c, peer.source.component).await?;
                    for binding in record.examples {
                        let result = validate_binding_in(&k, c, &binding, true).await;
                        examples.push(ManagedExample {
                            source: peer.source.clone(),
                            binding,
                            applicable: result.is_ok(),
                            problem: result.err().map(|e| e.to_string()),
                        });
                    }
                }
                Ok(VersionView {
                    model: page.origin.record.snapshot.model.id,
                    source,
                    in_origin: directory.in_origin,
                    version: unit,
                    correspondences,
                    examples,
                })
            })
        })
        .await
    }
}
