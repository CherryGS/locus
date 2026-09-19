use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{Mutex, MutexGuard},
};
use tokio::sync::Notify;
use uuid::Uuid;

/// Only its owner assigns meaning; cloned handles name the same binary resource.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Resource {
    pub(crate) coordinator: Uuid,
    pub(crate) key: Uuid,
}

#[derive(Default)]
pub(crate) struct Coordinator {
    pub(crate) state: Mutex<State>,
    pub(crate) changed: Notify,
}

#[derive(Default)]
pub(crate) struct State {
    pub(crate) named: HashMap<String, Resource>,
    pub(crate) requests: VecDeque<Request>,
    held: HashSet<Uuid>,
}

pub(crate) struct Request {
    pub(crate) id: Uuid,
    pub(crate) keys: HashSet<Uuid>,
    pub(crate) continuation: bool,
    pub(crate) granted: bool,
}

impl Coordinator {
    pub(crate) fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub(crate) fn release(&self, id: Uuid) {
        let mut state = self.lock();
        if let Some(index) = state.requests.iter().position(|r| r.id == id)
            && let Some(request) = state.requests.remove(index)
            && request.granted
        {
            for key in request.keys {
                state.held.remove(&key);
            }
        }
        state.admit();
        drop(state);
        self.changed.notify_waiters();
    }
}

impl State {
    // Only submitted and currently eligible continuations get preference. Blocked
    // requests reserve nothing and cannot obstruct disjoint work.
    pub(crate) fn admit(&mut self) {
        for continuation in [true, false] {
            for request in &mut self.requests {
                if !request.granted
                    && request.continuation == continuation
                    && request.keys.is_disjoint(&self.held)
                {
                    self.held.extend(request.keys.iter().copied());
                    request.granted = true;
                }
            }
        }
    }
}
