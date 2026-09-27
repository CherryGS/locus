use super::*;
use crate::{
    adapters::{AcquiredMedia, ProviderFuture, Upstream},
    identity::{CIVITAI_KIND, CivitaiId},
    owner::CivitaiOwner,
    persistence,
    record::CivitaiRecord,
    service::CivitaiService,
    snapshot::{Model, ModelVersion, PreviewImage, Snapshot},
};
use locus_core::api::{ComponentId, Kernel, Membership};
use locus_file::api::{FILE_KIND, FileOwner, FileService};
use locus_store::api::Session;
use std::sync::Arc;
struct NoNetwork;
impl Upstream for NoNetwork {
    fn by_hash(&self, _: [u8; 32]) -> ProviderFuture<'_, Option<ModelVersion>> {
        panic!("confirmation must not acquire")
    }
    fn model(&self, _: u64) -> ProviderFuture<'_, Model> {
        panic!("confirmation must not acquire")
    }
    fn example<'a>(&'a self, _: &'a PreviewImage) -> ProviderFuture<'a, AcquiredMedia> {
        panic!("confirmation must not acquire")
    }
}
struct TestFixture {
    root: tempfile::TempDir,
    files: FileService,
    s: Session,
    k: Kernel,
    service: CivitaiService,
    entity: locus_core::api::EntityId,
    file: locus_file::api::FileId,
    record: CivitaiRecord,
    media: locus_media::api::MediaService,
}
async fn fixture() -> TestFixture {
    let root = tempfile::tempdir().unwrap();
    let files = FileService::new(root.path().join("library")).await.unwrap();
    let mut s = Session::memory().await.unwrap();
    let mut k = Kernel::new();
    k.register(Arc::new(FileOwner)).unwrap();
    k.register(Arc::new(CivitaiOwner)).unwrap();
    k.register(Arc::new(locus_media::api::ImageOwner)).unwrap();
    k.register(Arc::new(locus_media::api::VideoOwner)).unwrap();
    locus_migration::api::migrate(&mut s).await.unwrap();
    let service = CivitaiService::with_upstream(Arc::new(NoNetwork));
    locus_migration::api::migrate(&mut s).await.unwrap();
    let path = root.path().join("weight");
    std::fs::write(&path, b"original bytes").unwrap();
    let file = files.admit(&k, &mut s, path).await.unwrap().id;
    let entity = k.create_entity(&mut s).await.unwrap();
    k.attach(
        &mut s,
        Membership {
            entity,
            kind: FILE_KIND,
            component: file.component(),
        },
    )
    .await
    .unwrap();
    let hash = blake3::hash(b"original bytes").to_hex().to_string();
    let version:ModelVersion=serde_json::from_value(serde_json::json!({"id":1,"modelId":1,"name":"v","files":[{"id":1,"name":"f","type":"Model","hashes":{"BLAKE3":hash}}]})).unwrap();
    let model: Model = serde_json::from_value(
        serde_json::json!({"id":1,"name":"m","type":"Model","modelVersions":[version]}),
    )
    .unwrap();
    let record = CivitaiRecord {
        id: CivitaiId::from_component(ComponentId::new()),
        revision: 0,
        observation: uuid::Uuid::now_v7().to_string(),
        basis: file,
        snapshot: Snapshot {
            model,
            lookup: version,
            matched_version: 1,
            matched_file: 1,
            blake3: hash,
        },
        examples: vec![],
    };
    let retained = record.clone();
    let kernel = k.clone();
    s.transaction(move |c| {
        Box::pin(async move {
            persistence::insert(c, &retained).await?;
            kernel
                .admit_component_in(c, CIVITAI_KIND, retained.id.component())
                .await?;
            kernel
                .attach_in(
                    c,
                    Membership {
                        entity,
                        kind: CIVITAI_KIND,
                        component: retained.id.component(),
                    },
                )
                .await?;
            Ok::<_, crate::error::CivitaiError>(())
        })
    })
    .await
    .unwrap();
    let media = locus_media::api::MediaService::new(files.root(), Default::default()).unwrap();
    locus_migration::api::migrate(&mut s).await.unwrap();
    TestFixture {
        root,
        files,
        s,
        k,
        service,
        entity,
        file,
        record,
        media,
    }
}
#[tokio::test(flavor = "multi_thread")]
async fn uncertain_metadata_confirms_exact_original_identity_and_never_recreates_absent_effect() {
    let TestFixture {
        root: _root,
        files,
        mut s,
        k,
        service,
        entity,
        file,
        record,
        media: _media,
    } = fixture().await;
    let mut original = Enrichment::new(entity, file, true);
    original.metadata = MetadataState::Uncertain;
    original.state = EnrichmentState::Uncertain;
    original.candidate = Some(record.clone());
    service.confirm(&k, &files, &mut s, &mut original).await;
    assert_eq!(original.state, EnrichmentState::Complete);
    assert_eq!(original.record.as_ref().unwrap().id, record.id);
    k.detach(
        &mut s,
        Membership {
            entity,
            kind: CIVITAI_KIND,
            component: record.id.component(),
        },
    )
    .await
    .unwrap();
    k.delete_component(&mut s, CIVITAI_KIND, record.id.component())
        .await
        .unwrap();
    let mut unavailable = Enrichment::new(entity, file, true);
    unavailable.metadata = MetadataState::Uncertain;
    unavailable.candidate = Some(record);
    service.confirm(&k, &files, &mut s, &mut unavailable).await;
    assert_eq!(unavailable.state, EnrichmentState::Uncertain);
    assert!(
        service
            .entity_view(&k, &mut s, entity)
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn uncertain_creation_and_interpretation_confirm_their_own_stage_then_continue_same_target() {
    for interpreted in [false, true] {
        let mut f = fixture().await;
        let path = f.root.path().join("example.png");
        image::RgbImage::new(12, 8).save(&path).unwrap();
        let file = f.files.admit(&f.k, &mut f.s, &path).await.unwrap().id;
        let entity = f.k.create_entity(&mut f.s).await.unwrap();
        f.k.attach(
            &mut f.s,
            Membership {
                entity,
                kind: FILE_KIND,
                component: file.component(),
            },
        )
        .await
        .unwrap();
        let image = f.media.create_image(&f.k, &mut f.s).await.unwrap();
        let media_id: locus_media::api::MediaId = image.into();
        f.k.attach(
            &mut f.s,
            Membership {
                entity,
                kind: locus_media::api::IMAGE_KIND,
                component: image.component(),
            },
        )
        .await
        .unwrap();
        if interpreted {
            f.media
                .interpret(&f.k, &f.files, &mut f.s, image)
                .await
                .unwrap();
        }
        let representation: PreviewImage = serde_json::from_value(
            serde_json::json!({"id":7,"url":"https://image.civitai.com/test.png","type":"image"}),
        )
        .unwrap();
        f.record.snapshot.model.model_versions[0].images = vec![representation.clone()];
        let stored = f.record.clone();
        f.s.transaction(move |c| Box::pin(async move { persistence::update(c, &stored).await }))
            .await
            .unwrap();
        let part = crate::examples::MediaCompletion {
            component: image.component(),
            image: true,
            revision: 0,
            preview_edge: 0,
            stream_index: None,
        };
        let binding = crate::examples::ExampleBinding {
            occurrence: 0,
            representation: representation.clone(),
            entity,
            file,
            acquired_observation: f.record.observation.clone(),
            content_type: "image/png".into(),
            media: vec![part.clone()],
            complete: false,
        };
        let mut example = crate::examples::ExampleWork::new(0, representation);
        example.outcome.binding = Some(binding);
        example.outcome.state = crate::examples::ExampleState::Uncertain;
        example.components = vec![part];
        example.component_uncertain = !interpreted;
        if interpreted {
            example.interpretation_uncertain = vec![media_id];
        }
        let mut work = Enrichment::new(f.entity, f.file, true);
        work.metadata = MetadataState::Accepted;
        work.record = Some(f.record.clone());
        work.state = EnrichmentState::Uncertain;
        work.examples = vec![example];
        f.service.confirm(&f.k, &f.files, &mut f.s, &mut work).await;
        f.service
            .enrich(&f.k, &f.files, &f.media, &mut f.s, &mut work, &|_| {})
            .await;
        assert_eq!(
            work.state(),
            EnrichmentState::Complete,
            "{:?}",
            work.problem()
        );
        let completed = work.examples().next().unwrap().binding.unwrap();
        assert_eq!(completed.entity, entity);
        assert_eq!(completed.media[0].component, image.component());
        assert_eq!(
            f.media.read(&mut f.s, image).await.unwrap().revision,
            1,
            "compatible accepted interpretation is not repeated"
        );
        let mut changed = f.service.read(&mut f.s, f.record.id).await.unwrap();
        changed.examples.clear();
        f.s.transaction(move |c| Box::pin(async move { persistence::update(c, &changed).await }))
            .await
            .unwrap();
        f.service
            .enrich(&f.k, &f.files, &f.media, &mut f.s, &mut work, &|_| {})
            .await;
        assert_eq!(
            work.state(),
            EnrichmentState::Conflict,
            "removed confirmed original relationship is not recreated"
        );
        assert!(
            f.service
                .read(&mut f.s, f.record.id)
                .await
                .unwrap()
                .examples
                .is_empty()
        );
    }
}
