#![allow(clippy::expect_used, clippy::unwrap_used)]
use locus_civitai::api::*;
use locus_core::api::{EntityId, Kernel, Membership};
use locus_file::api::{FILE_KIND, FileId, FileOwner, FileService};
use locus_media::api::{ImageOwner, MediaConfig, MediaService, VideoOwner};
use locus_store::api::Session;
use serde_json::json;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};

struct Provider {
    gate: Mutex<Option<(Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>)>>,
    no_match: AtomicBool,
    fail_parent: AtomicBool,
    model: Mutex<Model>,
    version: Mutex<ModelVersion>,
    fail_example: AtomicBool,
    calls: AtomicUsize,
    images: AtomicUsize,
    bytes: Vec<u8>,
    content_type: String,
}
impl Upstream for Provider {
    fn by_hash(&self, hash: [u8; 32]) -> ProviderFuture<'_, Option<ModelVersion>> {
        Box::pin(async move {
            let gate = self.gate.lock().unwrap().take();
            if let Some((entered, release)) = gate {
                entered.notify_one();
                release.notified().await;
            }
            self.calls.fetch_add(1, Ordering::SeqCst);
            assert_eq!(
                hash,
                *blake3::hash(b"actual admitted weight bytes").as_bytes(),
                "matching must hash the actual admitted bytes"
            );
            if self.no_match.load(Ordering::SeqCst) {
                return Ok(None);
            }
            let mut v = self.version.lock().unwrap().clone();
            v.files[0].hashes.insert(
                "BLAKE3".into(),
                blake3::Hash::from_bytes(hash).to_hex().to_string(),
            );
            Ok(Some(v))
        })
    }
    fn model(&self, _: u64) -> ProviderFuture<'_, Model> {
        Box::pin(async move {
            if self.fail_parent.load(Ordering::SeqCst) {
                return Err(CivitaiError::Acquisition(
                    "controlled parent failure".into(),
                ));
            }
            Ok(self.model.lock().unwrap().clone())
        })
    }
    fn example<'a>(&'a self, _: &'a PreviewImage) -> ProviderFuture<'a, AcquiredMedia> {
        Box::pin(async move {
            self.images.fetch_add(1, Ordering::SeqCst);
            if self.fail_example.load(Ordering::SeqCst) {
                return Err(CivitaiError::Acquisition(
                    "controlled example failure".into(),
                ));
            }
            Ok(AcquiredMedia {
                bytes: self.bytes.clone(),
                content_type: self.content_type.clone(),
            })
        })
    }
}
struct Fixture {
    _temp: tempfile::TempDir,
    k: Kernel,
    s: Session,
    f: FileService,
    m: MediaService,
    p: Arc<Provider>,
    c: CivitaiService,
}
impl Fixture {
    async fn new(examples: bool) -> Self {
        Self::configured(examples, MediaConfig::default(), None).await
    }
    async fn configured(
        examples: bool,
        config: MediaConfig,
        acquired: Option<AcquiredMedia>,
    ) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let mut k = Kernel::new();
        k.register(Arc::new(FileOwner)).unwrap();
        k.register(Arc::new(ImageOwner)).unwrap();
        k.register(Arc::new(VideoOwner)).unwrap();
        k.register(Arc::new(CivitaiOwner)).unwrap();
        let mut s = Session::open(temp.path().join("db.sqlite")).await.unwrap();
        let f = FileService::new(temp.path().join("library")).await.unwrap();
        let m = MediaService::new(f.root(), config).unwrap();
        let image = temp.path().join("sample.png");
        image::RgbImage::new(16, 16).save(&image).unwrap();
        let acquired = acquired.unwrap_or_else(|| AcquiredMedia {
            bytes: std::fs::read(image).unwrap(),
            content_type: "image/png".into(),
        });
        let mut version = json!({"id":10,"modelId":1,"name":"v1","files":[{"id":100,"name":"weight","type":"Model","extraFile":{"nested":true}},{"id":101,"name":"other","type":"Model"}],"images":[],"extraVersion":[1,2]});
        if examples {
            version["images"] = json!([{"id":900,"url":"https://image.civitai.com/test/example.png","type":"image","width":16,"height":16}]);
        }
        let model:Model=serde_json::from_value(json!({"id":1,"name":"M","type":"Checkpoint","description":"A description","modelVersions":[version.clone(),{"id":20,"modelId":1,"name":"listed only","files":[]}],"extraModel":{"deep":[true]}})).unwrap();
        let p = Arc::new(Provider {
            gate: Mutex::new(None),
            no_match: AtomicBool::new(false),
            fail_parent: AtomicBool::new(false),
            model: Mutex::new(model),
            version: Mutex::new(serde_json::from_value(version).unwrap()),
            fail_example: AtomicBool::new(false),
            calls: AtomicUsize::new(0),
            images: AtomicUsize::new(0),
            bytes: acquired.bytes,
            content_type: acquired.content_type,
        });
        let c = CivitaiService::with_upstream(p.clone());
        k.initialize(&mut s).await.unwrap();
        f.initialize(&mut s).await.unwrap();
        m.initialize(&mut s).await.unwrap();
        c.initialize(&mut s).await.unwrap();
        Self {
            _temp: temp,
            k,
            s,
            f,
            m,
            p,
            c,
        }
    }
    async fn weight(&mut self) -> (EntityId, FileId) {
        let path = self._temp.path().join("weight");
        std::fs::write(&path, b"actual admitted weight bytes").unwrap();
        let f = self.f.admit(&self.k, &mut self.s, path).await.unwrap();
        let e = self.k.create_entity(&mut self.s).await.unwrap();
        self.k
            .attach(
                &mut self.s,
                Membership {
                    entity: e,
                    kind: FILE_KIND,
                    component: f.id.component(),
                },
            )
            .await
            .unwrap();
        (e, f.id)
    }
    async fn run(&mut self, w: &mut Enrichment) {
        self.c
            .enrich(&self.k, &self.f, &self.m, &mut self.s, w, &|_| {})
            .await;
    }
}
#[tokio::test(flavor = "multi_thread")]
async fn complete_hierarchy_and_parent_optional_hash_are_retained() {
    let mut f = Fixture::new(false).await;
    let (e, file) = f.weight().await;
    let mut w = Enrichment::new(e, file, true);
    f.run(&mut w).await;
    assert_eq!(w.state(), EnrichmentState::Complete, "{:?}", w.problem());
    let r = w.record().unwrap();
    assert_eq!(r.snapshot.matched_file, 100);
    assert_eq!(r.snapshot.model.model_versions.len(), 2);
    assert_eq!(r.snapshot.model.extra["extraModel"]["deep"][0], true);
    assert_eq!(r.snapshot.matched().unwrap().files.len(), 2);
    assert!(r.snapshot.matched().unwrap().files[0].hashes.is_empty());
    let page = f.c.page(&f.k, &mut f.s, r.id).await.unwrap();
    assert_eq!(
        page.origin.record.snapshot.model.description.as_deref(),
        Some("A description")
    );
    assert_eq!(f.p.calls.load(Ordering::SeqCst), 1);
    let mut occupied = Enrichment::new(e, file, true);
    f.run(&mut occupied).await;
    assert_eq!(occupied.state(), EnrichmentState::Conflict);
    assert_eq!(f.p.calls.load(Ordering::SeqCst), 1);
}
#[tokio::test(flavor = "multi_thread")]
async fn metadata_survives_example_failure_and_original_continuation_reuses_target() {
    let mut f = Fixture::new(true).await;
    f.p.fail_example.store(true, Ordering::SeqCst);
    let (e, file) = f.weight().await;
    let mut w = Enrichment::new(e, file, true);
    f.run(&mut w).await;
    assert_eq!(w.metadata(), MetadataState::Accepted);
    assert_eq!(w.state(), EnrichmentState::Failed);
    let observation = w.record().unwrap().observation.clone();
    f.p.fail_example.store(false, Ordering::SeqCst);
    f.run(&mut w).await;
    assert_eq!(
        w.state(),
        EnrichmentState::Complete,
        "{:?}",
        w.examples().collect::<Vec<_>>()
    );
    assert_eq!(f.p.calls.load(Ordering::SeqCst), 1);
    assert_eq!(w.record().unwrap().observation, observation);
    let target = w
        .examples()
        .next()
        .unwrap()
        .binding
        .as_ref()
        .unwrap()
        .entity;
    let (e2, file2) = f.weight().await;
    let mut other = Enrichment::new(e2, file2, true);
    f.run(&mut other).await;
    assert_eq!(
        other.state(),
        EnrichmentState::Complete,
        "{:?}",
        other.problem()
    );
    let example = other.examples().next().unwrap();
    assert!(example.reused);
    assert_eq!(example.binding.as_ref().unwrap().entity, target);
    assert_eq!(f.p.images.load(Ordering::SeqCst), 2);
}
#[tokio::test(flavor = "multi_thread")]
async fn directory_uses_own_units_and_only_peer_actual_matches() {
    let mut f = Fixture::new(false).await;
    let (e, file) = f.weight().await;
    let mut a = Enrichment::new(e, file, true);
    f.run(&mut a).await;
    {
        let mut v = f.p.version.lock().unwrap();
        v.id = 30;
        v.files[0].id = 300;
    }
    {
        let mut m = f.p.model.lock().unwrap();
        m.description = Some("B description".into());
        let mut v = f.p.version.lock().unwrap().clone();
        v.description = Some("whole peer unit".into());
        m.model_versions = vec![
            v,
            serde_json::from_value(
                json!({"id":40,"modelId":1,"name":"peer listed only","files":[]}),
            )
            .unwrap(),
        ];
    }
    let (e2, file2) = f.weight().await;
    let mut b = Enrichment::new(e2, file2, true);
    f.run(&mut b).await;
    assert_eq!(b.state(), EnrichmentState::Complete, "{:?}", b.problem());
    let id = a.record().unwrap().id;
    let page = f.c.page(&f.k, &mut f.s, id).await.unwrap();
    assert_eq!(
        page.versions.iter().map(|v| v.id).collect::<Vec<_>>(),
        vec![10, 20, 30]
    );
    assert_eq!(
        page.origin.record.snapshot.model.description.as_deref(),
        Some("A description")
    );
    let v = f.c.version(&f.k, &mut f.s, id, 30, None).await.unwrap();
    assert_eq!(v.version.description.as_deref(), Some("whole peer unit"));
    assert!(!v.in_origin);
    assert_eq!(v.source.entity, e2);
    f.k.detach(
        &mut f.s,
        Membership {
            entity: e2,
            kind: CIVITAI_KIND,
            component: b.record().unwrap().id.component(),
        },
    )
    .await
    .unwrap();
    assert!(
        f.c.version(&f.k, &mut f.s, id, 30, Some(b.record().unwrap().id))
            .await
            .is_err()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn negative_and_failed_refresh_preserve_prior_snapshot_and_are_distinct() {
    let mut f = Fixture::new(false).await;
    let (e, file) = f.weight().await;
    let mut w = Enrichment::new(e, file, true);
    f.run(&mut w).await;
    let original = w.record().unwrap().clone();
    f.p.fail_parent.store(true, Ordering::SeqCst);
    let mut failed = Enrichment::new(e, file, false);
    f.run(&mut failed).await;
    assert_eq!(failed.metadata(), MetadataState::Failed);
    assert_eq!(f.c.read(&mut f.s, original.id).await.unwrap(), original);
    f.p.fail_parent.store(false, Ordering::SeqCst);
    f.p.no_match.store(true, Ordering::SeqCst);
    let mut negative = Enrichment::new(e, file, false);
    f.run(&mut negative).await;
    assert_eq!(negative.metadata(), MetadataState::NoMatch);
    assert_eq!(negative.state(), EnrichmentState::Complete);
    assert_eq!(f.c.read(&mut f.s, original.id).await.unwrap(), original);
    let calls = f.p.calls.load(Ordering::SeqCst);
    f.run(&mut negative).await;
    assert_eq!(calls, f.p.calls.load(Ordering::SeqCst));
    f.k.detach(
        &mut f.s,
        Membership {
            entity: e,
            kind: FILE_KIND,
            component: file.component(),
        },
    )
    .await
    .unwrap();
    f.run(&mut negative).await;
    assert_eq!(negative.state(), EnrichmentState::Conflict);
    assert_eq!(calls, f.p.calls.load(Ordering::SeqCst));
}
#[tokio::test(flavor = "multi_thread")]
async fn ambiguous_or_inconsistent_concrete_file_never_accepts_partial_metadata() {
    for mode in ["ambiguous", "missing", "contradictory", "parentage"] {
        let mut f = Fixture::new(false).await;
        if mode == "ambiguous" {
            f.p.version.lock().unwrap().files[1].hashes.insert(
                "BLAKE3".into(),
                blake3::hash(b"actual admitted weight bytes")
                    .to_hex()
                    .to_string(),
            );
        }
        {
            let mut model = f.p.model.lock().unwrap();
            match mode {
                "missing" => {
                    model.model_versions[0].files.remove(0);
                }
                "contradictory" => {
                    model.model_versions[0].files[0]
                        .hashes
                        .insert("BLAKE3".into(), "0".repeat(64));
                }
                "parentage" => model.model_versions[0].model_id = Some(2),
                _ => {}
            }
        }
        let (e, file) = f.weight().await;
        let mut w = Enrichment::new(e, file, true);
        f.run(&mut w).await;
        assert_eq!(w.metadata(), MetadataState::Failed, "{mode}");
        assert!(f.c.entity_view(&f.k, &mut f.s, e).await.unwrap().is_none());
    }
}
#[tokio::test(flavor = "multi_thread")]
async fn superseded_observation_rejects_original_example_continuation() {
    let mut f = Fixture::new(true).await;
    let (e, file) = f.weight().await;
    f.p.fail_example.store(true, Ordering::SeqCst);
    let mut original = Enrichment::new(e, file, true);
    f.run(&mut original).await;
    assert_eq!(original.metadata(), MetadataState::Accepted);
    f.p.model.lock().unwrap().model_versions[0].images.clear();
    let mut refresh = Enrichment::new(e, file, false);
    f.run(&mut refresh).await;
    assert_eq!(refresh.state(), EnrichmentState::Complete);
    let calls = f.p.calls.load(Ordering::SeqCst);
    f.run(&mut original).await;
    assert_eq!(original.state(), EnrichmentState::Conflict);
    assert_eq!(calls, f.p.calls.load(Ordering::SeqCst));
}
#[tokio::test(flavor = "multi_thread")]
async fn declared_video_poster_is_retained_as_partial_not_completed_video() {
    let mut f = Fixture::new(true).await;
    f.p.model.lock().unwrap().model_versions[0].images[0].kind = Some("video".into());
    let (e, file) = f.weight().await;
    let mut w = Enrichment::new(e, file, true);
    f.run(&mut w).await;
    assert_eq!(w.metadata(), MetadataState::Accepted);
    assert_eq!(w.state(), EnrichmentState::Failed);
    let outcome = w.examples().next().unwrap();
    assert!(outcome.file_registered && outcome.target_confirmed);
    assert!(outcome.problem.unwrap().contains("poster"));
    assert!(!outcome.binding.unwrap().complete);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires explicit provisioned ffprobe/ffmpeg; run just rust-test-civitai-video"]
async fn real_video_example_admission_cover_recovery_and_shared_reuse() {
    use locus_media::api::{Facts, MediaKind, PreviewOrigin, Rendition};
    use std::{path::PathBuf, time::Duration};

    let config = MediaConfig {
        ffprobe: std::env::var_os("LOCUS_FFPROBE")
            .map(PathBuf::from)
            .unwrap_or_else(|| "ffprobe".into()),
        ffmpeg: std::env::var_os("LOCUS_FFMPEG")
            .map(PathBuf::from)
            .unwrap_or_else(|| "ffmpeg".into()),
        ..MediaConfig::default()
    };
    let temporary = tempfile::tempdir().unwrap();
    let path = temporary.path().join("example.mp4");
    let output = tokio::time::timeout(
        Duration::from_secs(20),
        tokio::process::Command::new(&config.ffmpeg)
            .args([
                "-v",
                "error",
                "-nostdin",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=64x40:r=5:d=1",
                "-c:v",
                "mpeg4",
                "-threads",
                "1",
                "-y",
            ])
            .arg(&path)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let mut f = Fixture::configured(
        true,
        MediaConfig {
            ffmpeg: temporary.path().join("missing-cover-tool"),
            ..config.clone()
        },
        Some(AcquiredMedia {
            bytes: std::fs::read(path).unwrap(),
            content_type: "video/mp4".into(),
        }),
    )
    .await;
    f.p.model.lock().unwrap().model_versions[0].images[0].kind = Some("video".into());
    let (entity, file) = f.weight().await;
    let mut work = Enrichment::new(entity, file, true);
    f.run(&mut work).await;
    assert_eq!(work.metadata(), MetadataState::Accepted);
    assert_eq!(work.state(), EnrichmentState::Failed);
    let partial = work.examples().next().unwrap().binding.unwrap();
    assert!(!partial.complete);
    assert_eq!(partial.media.len(), 1);
    assert!(!partial.media[0].image);
    assert_eq!(partial.media[0].preview_edge, 0);

    f.m = MediaService::new(f.f.root(), config).unwrap();
    f.run(&mut work).await;
    assert_eq!(
        work.state(),
        EnrichmentState::Complete,
        "{:?}",
        work.problem()
    );
    let binding = work.examples().next().unwrap().binding.unwrap();
    assert_eq!(binding.entity, partial.entity);
    assert_eq!(binding.file, partial.file);
    assert_eq!(binding.media[0].component, partial.media[0].component);
    assert_eq!(binding.content_type, "video/mp4");
    assert_eq!(binding.media[0].stream_index, Some(0));
    assert_eq!(binding.media[0].preview_edge, 512);
    assert_eq!(f.p.images.load(Ordering::SeqCst), 1);

    let id = binding.media[0].id();
    let record = f.m.read(&mut f.s, id).await.unwrap();
    assert_eq!(record.basis, Some(binding.file));
    assert!(
        matches!(record.facts, Some(Facts::Video(facts)) if facts.width == Some(64) && facts.height == Some(40))
    );
    let cover =
        f.m.preview(&f.k, &f.f, &mut f.s, id, Rendition { edge: 512 })
            .await
            .unwrap();
    assert_eq!(cover.kind, MediaKind::Video);
    assert_eq!(cover.origin, PreviewOrigin::Hit);
    assert!(image::image_dimensions(cover.path).is_ok());

    let (other, other_file) = f.weight().await;
    let mut reused = Enrichment::new(other, other_file, true);
    f.run(&mut reused).await;
    assert_eq!(
        reused.state(),
        EnrichmentState::Complete,
        "{:?}",
        reused.problem()
    );
    let example = reused.examples().next().unwrap();
    assert!(example.reused);
    assert_eq!(example.binding.unwrap().entity, binding.entity);
    assert_eq!(f.p.images.load(Ordering::SeqCst), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn refresh_carries_eligible_targets_and_keeps_acquisition_provenance() {
    let mut f = Fixture::new(true).await;
    let (e, file) = f.weight().await;
    let mut a = Enrichment::new(e, file, true);
    f.run(&mut a).await;
    assert_eq!(a.state(), EnrichmentState::Complete);
    let old = a.examples().next().unwrap().binding.unwrap();
    let mut refresh = Enrichment::new(e, file, false);
    f.run(&mut refresh).await;
    assert_eq!(refresh.state(), EnrichmentState::Complete);
    let new = refresh.examples().next().unwrap().binding.unwrap();
    assert_eq!(old.entity, new.entity);
    assert_eq!(old.acquired_observation, new.acquired_observation);
    assert_eq!(f.p.images.load(Ordering::SeqCst), 1);
}
#[tokio::test(flavor = "multi_thread")]
async fn absent_remote_identity_never_reuses_and_target_change_blocks_original_work() {
    let mut f = Fixture::new(true).await;
    f.p.model.lock().unwrap().model_versions[0].images[0].id = None;
    let (e, file) = f.weight().await;
    let mut a = Enrichment::new(e, file, true);
    f.run(&mut a).await;
    let target = a.examples().next().unwrap().binding.unwrap();
    let (e2, file2) = f.weight().await;
    let mut b = Enrichment::new(e2, file2, true);
    f.run(&mut b).await;
    assert_ne!(
        target.entity,
        b.examples().next().unwrap().binding.unwrap().entity
    );
    f.k.detach(
        &mut f.s,
        Membership {
            entity: target.entity,
            kind: FILE_KIND,
            component: target.file.component(),
        },
    )
    .await
    .unwrap();
    f.run(&mut a).await;
    assert_eq!(a.state(), EnrichmentState::Conflict);
    assert_eq!(f.p.images.load(Ordering::SeqCst), 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn first_acceptance_rejects_raced_slot_and_file_without_adopting_them() {
    for change_file in [false, true] {
        let mut f = Fixture::new(false).await;
        let (entity, file) = f.weight().await;
        let entered = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        *f.p.gate.lock().unwrap() = Some((entered.clone(), release.clone()));
        let service = f.c.clone();
        let k = f.k.clone();
        let files = f.f.clone();
        let media = f.m.clone();
        let database = f._temp.path().join("db.sqlite");
        let pending = tokio::spawn(async move {
            let mut s = Session::open(database).await.unwrap();
            let mut work = Enrichment::new(entity, file, true);
            service
                .enrich(&k, &files, &media, &mut s, &mut work, &|_| {})
                .await;
            work
        });
        entered.notified().await;
        if change_file {
            let (other, replacement) = f.weight().await;
            f.k.detach(
                &mut f.s,
                Membership {
                    entity: other,
                    kind: FILE_KIND,
                    component: replacement.component(),
                },
            )
            .await
            .unwrap();
            f.k.detach(
                &mut f.s,
                Membership {
                    entity,
                    kind: FILE_KIND,
                    component: file.component(),
                },
            )
            .await
            .unwrap();
            f.k.attach(
                &mut f.s,
                Membership {
                    entity,
                    kind: FILE_KIND,
                    component: replacement.component(),
                },
            )
            .await
            .unwrap();
        } else {
            let mut other = Enrichment::new(entity, file, true);
            f.run(&mut other).await;
            assert_eq!(other.state(), EnrichmentState::Complete);
        }
        release.notify_one();
        let work = pending.await.unwrap();
        assert_eq!(work.state(), EnrichmentState::Conflict);
        let current = f.c.entity_view(&f.k, &mut f.s, entity).await.unwrap();
        if change_file {
            assert!(current.is_none());
        } else {
            assert_eq!(current.unwrap().record.revision, 0);
        }
    }
}
#[tokio::test(flavor = "multi_thread")]
async fn independent_media_accepts_later_input_but_original_relationship_is_rejected() {
    let mut f = Fixture::new(true).await;
    let (entity, file) = f.weight().await;
    let mut work = Enrichment::new(entity, file, true);
    f.run(&mut work).await;
    let binding = work.examples().next().unwrap().binding.unwrap();
    let part = binding.media[0].id();
    let path = f._temp.path().join("later.png");
    image::RgbImage::new(24, 20).save(&path).unwrap();
    let later = f.f.admit(&f.k, &mut f.s, path).await.unwrap();
    f.k.detach(
        &mut f.s,
        Membership {
            entity: binding.entity,
            kind: FILE_KIND,
            component: binding.file.component(),
        },
    )
    .await
    .unwrap();
    f.k.attach(
        &mut f.s,
        Membership {
            entity: binding.entity,
            kind: FILE_KIND,
            component: later.id.component(),
        },
    )
    .await
    .unwrap();
    let outcome = f.m.interpret(&f.k, &f.f, &mut f.s, part).await.unwrap();
    assert!(
        matches!(outcome,locus_media::api::ApplyOutcome::Accepted(ref r) if r.basis==Some(later.id))
    );
    assert!(matches!(
        f.c.validate_completion(&f.k, &mut f.s, &work).await,
        Err(CivitaiError::Conflict)
    ));
    assert_eq!(
        f.m.read(&mut f.s, part).await.unwrap().basis,
        Some(later.id)
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn passive_preview_read_finds_existing_output_and_never_regenerates_missing_cache() {
    let mut f = Fixture::new(true).await;
    let (entity, file) = f.weight().await;
    let mut w = Enrichment::new(entity, file, true);
    f.run(&mut w).await;
    let binding = w.examples().next().unwrap().binding.unwrap();
    let id = binding.media[0].id();
    let rendition = locus_media::api::Rendition { edge: 512 };
    let preview =
        f.m.read_preview(&f.k, &mut f.s, id, rendition)
            .await
            .unwrap()
            .unwrap();
    let parent = preview.path.parent().unwrap().to_path_buf();
    f.m.clear_cache().await.unwrap();
    std::fs::remove_dir(&parent).unwrap();
    assert!(
        f.m.read_preview(&f.k, &mut f.s, id, rendition)
            .await
            .unwrap()
            .is_none()
    );
    assert!(!parent.exists());
    assert_eq!(f.m.read(&mut f.s, id).await.unwrap().revision, 1);
}
