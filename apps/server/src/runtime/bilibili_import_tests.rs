use super::registered_import_tests::{accepted, app, file, item, recover, terminal};
use crate::{api::imports::dto::*, imports::BaseFault};

fn snapshot(index: u32, role: &str) -> crate::api::bilibili::dto::BilibiliSnapshot {
    serde_json::from_value(serde_json::json!({
        "bvid": "BV145PxzCEoE", "aid": "18446744073709551615",
        "page_url": format!("https://www.bilibili.com/video/BV145PxzCEoE/?p={index}"),
        "title": "Example submission", "description": "Full description\nSecond line",
        "part": {"cid": format!("3653193022{index}"), "index": index, "title": format!("Part {index}"), "duration_ms": "26422"},
        "asset_role": role,
        "published_at_unix_ms": "1720000000000",
        "uploader": {"user_id": "123456789", "display_name": "Uploader"}
    })).unwrap()
}
fn request(file: Option<String>, index: u32, role: &str) -> RegisteredImportRequest {
    RegisteredImportRequest {
        request_id: uuid::Uuid::now_v7().to_string(),
        items: vec![RegisteredImportItem {
            file_id: file,
            twitter: None,
            bilibili: Some(snapshot(index, role)),
        }],
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn bilibili_parts_and_cover_keep_independent_source_identity_and_read_values() {
    let (_root, server, _) = app().await;
    let state = &server.state;
    let mut ids = Vec::new();
    for (index, role) in [(1, "video"), (2, "video"), (2, "cover")] {
        let request = request(None, index, role);
        let receipt = accepted(state, &request).await.unwrap();
        terminal(state, &receipt.task_id).await;
        let saved = item(state, &request.request_id);
        assert!(saved.requested_bilibili && !saved.requested_twitter);
        assert_eq!(saved.current.overall, Some(ImportOverall::Success));
        assert_eq!(saved.current.twitter.state, ImportStepState::NotRequested);
        assert_eq!(saved.current.bilibili.state, ImportStepState::Success);
        assert!(saved.current.twitter_id.is_none());
        let id = saved.current.bilibili_id.unwrap();
        let identity = locus_bilibili::api::BilibiliId::from_bytes(
            uuid::Uuid::parse_str(&id).unwrap().as_bytes(),
        )
        .unwrap();
        let view = state.bilibili_view(identity).await.unwrap();
        assert_eq!(view.record.snapshot, snapshot(index, role));
        assert!(view.record.basis.is_none());
        assert!(!ids.contains(&id));
        ids.push(id);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn bilibili_rejects_conflicting_locators_and_ambiguous_provider_selection() {
    let (_root, server, _) = app().await;
    let state = &server.state;
    let mut invalid = request(None, 2, "video");
    invalid.items[0]
        .bilibili
        .as_mut()
        .unwrap()
        .part
        .as_mut()
        .unwrap()
        .index = Some(1);
    assert!(accepted(state, &invalid).await.is_err());
    let mut ambiguous = request(None, 2, "video");
    ambiguous.items[0].twitter = Some(crate::api::twitter::dto::TwitterSnapshot {
        post_id: Some("123456789".into()),
        ..Default::default()
    });
    assert!(accepted(state, &ambiguous).await.is_err());
    assert!(state.import_snapshot().batches.is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn bilibili_unknown_source_and_association_continue_original_identities() {
    for association in [false, true] {
        let (_root, server, path) = app().await;
        let state = &server.state;
        let request = request(Some(file(state, path).await), 2, "video");
        if association {
            *state.imports.association_fault.lock().unwrap() = Some(BaseFault::Unknown);
        } else {
            *state.imports.source_fault.lock().unwrap() = Some(BaseFault::Unknown);
        }
        let receipt = accepted(state, &request).await.unwrap();
        terminal(state, &receipt.task_id).await;
        let old = item(state, &request.request_id);
        assert_eq!(old.actions, vec![ImportAction::Confirm]);
        let confirmed = recover(state, &request.request_id, ImportAction::Confirm).await;
        assert_eq!(confirmed.current.bilibili_id, old.current.bilibili_id);
        assert_eq!(confirmed.current.entity_id, old.current.entity_id);
        let completed = if confirmed.current.complete {
            confirmed
        } else {
            recover(state, &request.request_id, ImportAction::Retry).await
        };
        assert_eq!(completed.current.overall, Some(ImportOverall::Success));
        assert_eq!(completed.current.bilibili.state, ImportStepState::Success);
        assert_eq!(
            completed.current.association.state,
            ImportStepState::Success
        );
        assert_eq!(completed.current.file_id, old.current.file_id);
        assert_eq!(completed.attempts[0], old.attempts[0]);
    }
}
