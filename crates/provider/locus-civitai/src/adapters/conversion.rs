use crate::snapshot::*;
impl From<provider_civitai::model::Model> for Model {
    fn from(value: provider_civitai::model::Model) -> Self {
        Self {
            id: value.id,
            name: value.name,
            description: value.description,
            kind: value.kind,
            nsfw: value.nsfw,
            nsfw_level: value.nsfw_level,
            availability: value.availability,
            supports_generation: value.supports_generation,
            stats: value.stats.map(Into::into),
            creator: value.creator.map(Into::into),
            tags: value.tags,
            model_versions: value.model_versions.into_iter().map(Into::into).collect(),
            extra: value.extra,
        }
    }
}
impl From<provider_civitai::model::Creator> for Creator {
    fn from(value: provider_civitai::model::Creator) -> Self {
        Self {
            username: value.username,
            image: value.image,
            extra: value.extra,
        }
    }
}
impl From<provider_civitai::model::Stats> for Stats {
    fn from(value: provider_civitai::model::Stats) -> Self {
        Self {
            download_count: value.download_count,
            thumbs_up_count: value.thumbs_up_count,
            thumbs_down_count: value.thumbs_down_count,
            comment_count: value.comment_count,
            tipped_amount_count: value.tipped_amount_count,
            extra: value.extra,
        }
    }
}
impl From<provider_civitai::model::ModelVersion> for ModelVersion {
    fn from(value: provider_civitai::model::ModelVersion) -> Self {
        Self {
            id: value.id,
            model_id: value.model_id,
            name: value.name,
            description: value.description,
            base_model: value.base_model,
            base_model_type: value.base_model_type,
            published_at: value.published_at,
            availability: value.availability,
            supports_generation: value.supports_generation,
            stats: value.stats.map(Into::into),
            files: value.files.into_iter().map(Into::into).collect(),
            images: value.images.into_iter().map(Into::into).collect(),
            extra: value.extra,
        }
    }
}
impl From<provider_civitai::model::ModelFile> for ModelFile {
    fn from(value: provider_civitai::model::ModelFile) -> Self {
        Self {
            id: value.id,
            name: value.name,
            kind: value.kind,
            size_kb: value.size_kb,
            download_url: value.download_url,
            primary: value.primary,
            hashes: value.hashes,
            metadata: value.metadata,
            extra: value.extra,
        }
    }
}
impl From<provider_civitai::model::PreviewImage> for PreviewImage {
    fn from(value: provider_civitai::model::PreviewImage) -> Self {
        Self {
            id: value.id,
            url: value.url,
            nsfw_level: value.nsfw_level,
            width: value.width,
            height: value.height,
            hash: value.hash,
            kind: value.kind,
            extra: value.extra,
        }
    }
}
