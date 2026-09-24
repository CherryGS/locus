use super::*;
#[test]
fn pre_work_session_failure_is_retryable_but_unknown_execution_effects_are_not_replayed() {
    let store = CivitaiOperationsStore::default();
    let r = CivitaiRequest {
        request_id: uuid::Uuid::now_v7().to_string(),
        entity_id: uuid::Uuid::now_v7().to_string(),
        file_id: uuid::Uuid::now_v7().to_string(),
        first_only: true,
        continuation: None,
    };
    store.reserve(&r).unwrap();
    {
        let mut entries = store.lock();
        let entry = entries.get_mut(&r.request_id).unwrap();
        entry.active = None;
        entry.problem = Some("Observed session open failure before provider work".into());
    }
    let mut retry = r.clone();
    retry.request_id = uuid::Uuid::now_v7().to_string();
    retry.continuation = Some(r.request_id.clone());
    store.reserve(&retry).unwrap();
    store.end_unfinished(&retry.request_id);
    let mut again = retry.clone();
    again.request_id = uuid::Uuid::now_v7().to_string();
    assert!(store.reserve(&again).is_err());
    let mut fresh = r;
    fresh.request_id = uuid::Uuid::now_v7().to_string();
    assert!(store.reserve(&fresh).is_err());
}
