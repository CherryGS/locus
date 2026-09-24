use super::ExampleBinding;
use crate::{
    error::CivitaiError, identity::CIVITAI_KIND, record::CivitaiRecord, service::CivitaiService,
};
use locus_core::api::{EntityId, Kernel, Membership};
use locus_file::api::{CurrentInput, FileService, observe_input_in};
use locus_media::api::MediaService;
use locus_store::api::Context;
pub(crate) async fn validate_observation_in(
    k: &Kernel,
    c: &mut Context,
    host: EntityId,
    r: &CivitaiRecord,
) -> Result<CivitaiRecord, CivitaiError> {
    if k.attachment_in(c, r.id.component()).await?
        != Some(Membership {
            entity: host,
            kind: CIVITAI_KIND,
            component: r.id.component(),
        })
        || observe_input_in(k, c, host).await? != CurrentInput::File(r.basis)
    {
        return Err(CivitaiError::Conflict);
    }
    FileService::read_in(c, r.basis).await?;
    let actual = CivitaiService::read_in(c, r.id).await?;
    if actual.observation != r.observation
        || actual.revision != r.revision
        || actual.basis != r.basis
    {
        return Err(CivitaiError::Conflict);
    }
    Ok(actual)
}
pub(crate) async fn validate_binding_in(
    k: &Kernel,
    c: &mut Context,
    b: &ExampleBinding,
    complete: bool,
) -> Result<(), CivitaiError> {
    if observe_input_in(k, c, b.entity).await? != CurrentInput::File(b.file) {
        return Err(CivitaiError::Conflict);
    }
    FileService::read_in(c, b.file).await?;
    if complete && (!b.complete || b.media.is_empty()) {
        return Err(CivitaiError::Invalid(
            "example processing incomplete".into(),
        ));
    }
    for part in &b.media {
        let id = part.id();
        let membership = match k.attachment_in(c, id.component()).await {
            Err(locus_core::api::CoreError::MissingComponent(_)) => {
                return Err(CivitaiError::Conflict);
            }
            value => value?,
        };
        if membership
            != Some(Membership {
                entity: b.entity,
                kind: id.kind().kind(),
                component: id.component(),
            })
        {
            return Err(CivitaiError::Conflict);
        }
        let record = MediaService::read_in(c, id).await?;
        if complete
            && (record.basis != Some(b.file)
                || record.facts.is_none()
                || record.last_failure.is_some()
                || record.revision < part.revision
                || matches!(&record.facts,Some(locus_media::api::Facts::Video(f)) if Some(f.stream_index)!=part.stream_index))
        {
            return Err(CivitaiError::Conflict);
        }
    }
    Ok(())
}
