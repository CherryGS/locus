use super::{ImportStore, model::Item};
use crate::runtime::composition::Domain;
use locus_core::api::EntityId;
use locus_file::api::FileId;
use locus_store::api::Session;
impl ImportStore {
    pub(super) async fn process_civitai(
        &self,
        d: &Domain,
        s: &mut Session,
        batch: &str,
        item: &mut Item,
        entity: EntityId,
        file: FileId,
    ) {
        if !item.current.model.recognition.success() {
            return;
        }
        let mut work = item
            .current
            .civitai
            .clone()
            .unwrap_or_else(|| locus_civitai::api::Enrichment::new(entity, file, true));
        let baseline = work.effect();
        let original = item.clone();
        d.civitai
            .enrich(&d.kernel, &d.files, &d.media, s, &mut work, &|work| {
                let mut current = original.clone();
                current.current.effect += work.effect() - baseline;
                current.current.civitai = Some(work.clone());
                self.publish(batch, &current);
            })
            .await;
        item.current.effect += work.effect() - baseline;
        item.current.civitai = Some(work);
        self.publish(batch, item);
    }
    pub(super) async fn validate_completed_dependencies(
        &self,
        d: &Domain,
        s: &mut Session,
        item: &mut Item,
    ) -> anyhow::Result<()> {
        let (Some(entity), Some(file)) = (item.current.entity, item.current.file) else {
            return Ok(());
        };
        let kernel = d.kernel.clone();
        let result = item.current.clone();
        s.transaction_named("Validate whole imported item", move |c| {
            Box::pin(async move {
                use locus_file::api::{CurrentInput, observe_input_in};
                if observe_input_in(&kernel, c, entity).await? != CurrentInput::File(file) {
                    anyhow::bail!("Original imported File changed");
                }
                locus_file::api::FileService::read_in(c, file).await?;
                let members = kernel.memberships_in(c, entity).await?;
                for kind in &result.kinds {
                    if !kind.complete() || !kind.recognition.success() {
                        continue;
                    }
                    let id = kind
                        .component
                        .ok_or_else(|| anyhow::anyhow!("Missing original Media identity"))?;
                    if !members
                        .iter()
                        .any(|m| m.component == id.component() && m.kind == id.kind().kind())
                    {
                        anyhow::bail!("Original Media membership changed");
                    }
                    let r = locus_media::api::MediaService::read_in(c, id).await?;
                    if r.basis != Some(file)
                        || r.facts.is_none()
                        || r.last_failure.is_some()
                        || kind
                            .output
                            .as_ref()
                            .is_none_or(|p| p.file != file || p.kind != id.kind())
                    {
                        anyhow::bail!("Required Media result no longer applies");
                    }
                }
                if result.model.complete() && result.model.recognition.success() {
                    let id = result
                        .model
                        .component
                        .ok_or_else(|| anyhow::anyhow!("Missing original Model identity"))?;
                    if !members.iter().any(|m| {
                        m.component == id.component() && m.kind == locus_model::api::MODEL_KIND
                    }) {
                        anyhow::bail!("Original Model membership changed");
                    }
                    let r = locus_model::api::ModelService::read_in(c, id).await?;
                    if r.basis != Some(file) || r.facts.is_none() || r.last_failure.is_some() {
                        anyhow::bail!("Required Model result no longer applies");
                    }
                }
                if let Some(id) = result.source_id {
                    if !members
                        .iter()
                        .any(|m| m.component == id.component() && m.kind == id.kind())
                    {
                        anyhow::bail!("Original Source membership changed");
                    }
                    let source = id.read_in(c).await?;
                    if Some(source.revision) != result.source_revision
                        || (result.association.success() && source.basis != Some(file))
                    {
                        anyhow::bail!("Original Source observation/association changed");
                    }
                }
                if let Some(work) = &result.civitai
                    && work.state() == locus_civitai::api::EnrichmentState::Complete
                {
                    locus_civitai::api::CivitaiService::validate_completion_in(&kernel, c, work)
                        .await?;
                }
                Ok::<_, anyhow::Error>(())
            })
        })
        .await?;

        Ok(())
    }
}
