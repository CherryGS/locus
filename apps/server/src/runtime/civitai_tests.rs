use super::{Server, ServerConfig, Shared};
use crate::api::{
    civitai::dto::*,
    dto::{OutcomeResponse, TaskOutcome},
    imports::dto::*,
};
use locus_civitai::api::*;
use serde_json::json;
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};
struct Provider {
    fail_parent: AtomicBool,
    fail_example: AtomicBool,
    no_match: AtomicBool,
    calls: AtomicUsize,
    examples: bool,
    bytes: Vec<u8>,
}
impl Provider {
    fn version(&self, hash: String) -> ModelVersion {
        serde_json::from_value(json!({"id":9007199254740993u64,"modelId":9007199254740995u64,"name":"Exact version","files":[{"id":9007199254740997u64,"name":"weight","type":"Model","hashes":{"BLAKE3":hash}}],"images":if self.examples{json!([{"id":9007199254740999u64,"url":"https://image.civitai.com/test.png","type":"image"}])}else{json!([])}})).unwrap()
    }
}
impl Upstream for Provider {
    fn by_hash(&self, hash: [u8; 32]) -> ProviderFuture<'_, Option<ModelVersion>> {
        Box::pin(async move {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if self.no_match.load(Ordering::SeqCst) {
                return Ok(None);
            }
            Ok(Some(self.version(
                hash.iter().map(|b| format!("{b:02x}")).collect(),
            )))
        })
    }
    fn model(&self, _: u64) -> ProviderFuture<'_, Model> {
        Box::pin(async move {
            if self.fail_parent.load(Ordering::SeqCst) {
                return Err(CivitaiError::Acquisition(
                    "controlled parent failure".into(),
                ));
            }
            let mut version = self.version("".into());
            version.files[0].hashes.clear();
            serde_json::from_value(json!({"id":9007199254740995u64,"name":"Exact model","type":"Checkpoint","modelVersions":[version]})).map_err(|e|CivitaiError::Acquisition(e.to_string()))
        })
    }
    fn example<'a>(&'a self, _: &'a PreviewImage) -> ProviderFuture<'a, AcquiredMedia> {
        Box::pin(async move {
            if self.fail_example.load(Ordering::SeqCst) {
                return Err(CivitaiError::Acquisition(
                    "controlled example failure".into(),
                ));
            }
            Ok(AcquiredMedia {
                bytes: self.bytes.clone(),
                content_type: "image/png".into(),
            })
        })
    }
}
async fn app(examples: bool) -> (tempfile::TempDir, Server, Arc<Provider>, String) {
    let root = tempfile::tempdir().unwrap();
    let image = root.path().join("sample.png");
    image::RgbImage::new(8, 8).save(&image).unwrap();
    let p = Arc::new(Provider {
        fail_parent: AtomicBool::new(false),
        fail_example: AtomicBool::new(false),
        no_match: AtomicBool::new(false),
        calls: AtomicUsize::new(0),
        examples,
        bytes: std::fs::read(image).unwrap(),
    });
    let mut config = ServerConfig::new(
        "civitai-tests-private-credential-32-characters".into(),
        root.path().join("library"),
    );
    config.civitai_upstream = Some(p.clone());
    let server = Server::bind(config).await.unwrap();
    let path = root.path().join("weight.safetensors");
    let header = b"{\"scalar\":{\"dtype\":\"F32\",\"shape\":[],\"data_offsets\":[0,4]}}";
    let mut bytes = (header.len() as u64).to_le_bytes().to_vec();
    bytes.extend(header);
    bytes.extend([0; 4]);
    std::fs::write(&path, bytes).unwrap();
    (root, server, p, path.to_string_lossy().into_owned())
}
async fn terminal(s: &Arc<Shared>, id: &str) -> TaskOutcome {
    let mut changes = s.changes.subscribe();
    tokio::time::timeout(std::time::Duration::from_secs(20), async {
        loop {
            if let OutcomeResponse::Complete { outcome } = s.outcome(id).unwrap() {
                return outcome;
            }
            changes.changed().await.unwrap();
        }
    })
    .await
    .unwrap()
}
async fn import(s: &Arc<Shared>, path: String) -> ImportItem {
    let receipt = s
        .import_batch(BatchImportRequest {
            request_id: uuid::Uuid::now_v7().to_string(),
            source_paths: vec![path],
        })
        .unwrap();
    terminal(s, &receipt.task_id).await;
    s.import_snapshot().batches.last().unwrap().items[0].clone()
}
#[tokio::test(flavor = "multi_thread")]
async fn provider_failure_fails_import_independent_of_inspection_and_retry_keeps_weight() {
    let (_root, server, p, path) = app(false).await;
    p.fail_parent.store(true, Ordering::SeqCst);
    let item = import(&server.state, path).await;
    assert_eq!(
        item.current.model.inspection.state,
        ImportStepState::Success
    );
    assert!(!item.current.complete);
    let original_file = item.current.file_id.clone();
    let batch = server.state.import_snapshot().batches[0].batch_id.clone();
    p.fail_parent.store(false, Ordering::SeqCst);
    let r = server
        .state
        .recover_import(ImportRecoveryRequest {
            request_id: uuid::Uuid::now_v7().to_string(),
            batch_id: batch,
            item_id: item.item_id,
            action: ImportAction::Retry,
        })
        .unwrap();
    terminal(&server.state, &r.task_id).await;
    let now = &server.state.import_snapshot().batches[0].items[0].current;
    assert!(now.complete);
    assert_eq!(now.file_id, original_file);
    let view = server
        .state
        .civitai_view(
            CivitaiId::from_bytes(
                uuid::Uuid::parse_str(now.civitai.as_ref().unwrap().component_id.as_ref().unwrap())
                    .unwrap()
                    .as_bytes(),
            )
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(view.record.model.id, "9007199254740995");
    assert_eq!(view.record.matched_version, "9007199254740993");
    assert_eq!(view.record.matched_file, "9007199254740997");
}
#[tokio::test(flavor = "multi_thread")]
async fn failed_model_inspection_still_runs_provider_and_negative_is_retained_on_retry() {
    let (_root, server, p, path) = app(false).await;
    p.no_match.store(true, Ordering::SeqCst);
    let broken = b"{\"broken\":{}}";
    let mut bytes = (broken.len() as u64).to_le_bytes().to_vec();
    bytes.extend(broken);
    std::fs::write(&path, bytes).unwrap();
    let item = import(&server.state, path).await;
    assert_eq!(
        item.current.model.recognition.state,
        ImportStepState::Success
    );
    assert_eq!(item.current.model.inspection.state, ImportStepState::Failed);
    assert_eq!(
        item.current.civitai.as_ref().unwrap().metadata,
        CivitaiMetadataState::NoMatch
    );
    let batch = server.state.import_snapshot().batches[0].batch_id.clone();
    let r = server
        .state
        .recover_import(ImportRecoveryRequest {
            request_id: uuid::Uuid::now_v7().to_string(),
            batch_id: batch,
            item_id: item.item_id,
            action: ImportAction::Retry,
        })
        .unwrap();
    terminal(&server.state, &r.task_id).await;
    assert_eq!(p.calls.load(Ordering::SeqCst), 1);
}
#[tokio::test(flavor = "multi_thread")]
async fn explicit_continuation_keeps_original_task_outcome_and_snapshot() {
    let (_root, server, p, path) = app(true).await;
    p.no_match.store(true, Ordering::SeqCst);
    let item = import(&server.state, path).await;
    p.no_match.store(false, Ordering::SeqCst);
    p.fail_example.store(true, Ordering::SeqCst);
    let request = CivitaiRequest {
        request_id: uuid::Uuid::now_v7().to_string(),
        entity_id: item.current.entity_id.unwrap(),
        file_id: item.current.file_id.unwrap(),
        first_only: true,
        continuation: None,
    };
    let receipt = server.state.enrich_civitai(request.clone()).unwrap();
    assert_eq!(
        receipt,
        server.state.enrich_civitai(request.clone()).unwrap()
    );
    let original = terminal(&server.state, &receipt.task_id).await;
    let TaskOutcome::Civitai {
        result: Some(ref first),
        ..
    } = original
    else {
        panic!("provider result missing")
    };
    assert_eq!(first.state, CivitaiState::Failed);
    assert_eq!(first.metadata, CivitaiMetadataState::Accepted);
    let observation = first.observation.clone();
    let count = p.calls.load(Ordering::SeqCst);
    p.fail_example.store(false, Ordering::SeqCst);
    let mut continuation = request.clone();
    continuation.request_id = uuid::Uuid::now_v7().to_string();
    continuation.continuation = Some(request.request_id);
    let r = server.state.enrich_civitai(continuation).unwrap();
    let TaskOutcome::Civitai {
        result: Some(last), ..
    } = terminal(&server.state, &r.task_id).await
    else {
        panic!("provider result missing")
    };
    assert_eq!(last.state, CivitaiState::Complete);
    assert_eq!(last.observation, observation);
    assert_eq!(p.calls.load(Ordering::SeqCst), count);
    assert_eq!(terminal(&server.state, &receipt.task_id).await, original);
}
