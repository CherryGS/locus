use super::{
    record::{Checkpoint, Publication},
    worker::Worker,
};
use crate::{error::SearchError, journal};
use locus_core::api::EntityId;
use tantivy::{Index, IndexWriter, ReloadPolicy, TantivyDocument, Term};

/// A writer's owned threads are joined even when its surrounding future is dropped.
pub(super) struct Writer(Option<IndexWriter>);
impl Writer {
    pub(super) fn get(&mut self) -> Result<&mut IndexWriter, SearchError> {
        self.0
            .as_mut()
            .ok_or_else(|| SearchError::Invalid("closed writer".into()))
    }
}
impl Drop for Writer {
    fn drop(&mut self) {
        if let Some(writer) = self.0.take() {
            let _ = writer.wait_merging_threads();
        }
    }
}
impl Worker {
    pub(super) async fn maintain(&self, rebuild: bool) -> Result<(), SearchError> {
        let boundary = self.db(|c| Box::pin(journal::boundary(c))).await?;
        self.status(|s| s.journal_head = boundary.head.to_string());
        let mut publication = self
            .shared
            .publication
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        if publication.is_none() && !rebuild {
            publication = self.reopen(&boundary.identity, boundary.head)?;
            if let Some(baseline) = &publication {
                self.publish(baseline.clone());
            }
        }
        let publication = if rebuild || publication.is_none() {
            self.build(&boundary.identity).await?
        } else {
            publication.ok_or_else(|| SearchError::Invalid("publication".into()))?
        };
        let publication = self.catch_up(publication).await?;
        self.publish(publication);
        Ok(())
    }
    fn reopen(&self, identity: &str, head: i64) -> Result<Option<Publication>, SearchError> {
        let pointer = self.root.join("current");
        if !pointer.exists() {
            return Ok(None);
        }
        let generation = std::fs::read_to_string(pointer)?;
        if uuid::Uuid::parse_str(&generation).is_err() {
            return Ok(None);
        }
        let index = match Index::open_in_dir(self.root.join(&generation)) {
            Ok(index) => index,
            Err(_) => return Ok(None),
        };
        self.mapping.configure(&index);
        let metas = match index.load_metas() {
            Ok(m) => m,
            Err(_) => return Ok(None),
        };
        let checkpoint: Checkpoint = match metas.payload.as_deref().map(serde_json::from_str) {
            Some(Ok(c)) => c,
            _ => return Ok(None),
        };
        if checkpoint.identity != identity
            || checkpoint.fingerprint != self.mapping.fingerprint
            || checkpoint.generation != generation
            || checkpoint.covered > head
            || checkpoint.covered < 0
            || index.schema() != self.mapping.schema
        {
            return Ok(None);
        }
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;
        Ok(Some(Publication {
            _lease: self.lease(&checkpoint.generation),
            index,
            reader,
            checkpoint,
        }))
    }
    pub(super) fn writer(&self, index: &Index) -> Result<Writer, SearchError> {
        Ok(Writer(Some(index.writer_with_num_threads(1, 50_000_000)?)))
    }
    pub(super) fn commit(
        &self,
        writer: &mut Writer,
        checkpoint: &Checkpoint,
    ) -> Result<(), SearchError> {
        #[cfg(test)]
        self.fault(1)?;
        let mut commit = writer.get()?.prepare_commit()?;
        commit.set_payload(&serde_json::to_string(checkpoint)?);
        commit.commit()?;
        #[cfg(test)]
        self.fault(2)?;
        Ok(())
    }
    async fn build(&self, identity: &str) -> Result<Publication, SearchError> {
        self.status(|s| {
            s.state = if s.usable { "rebuilding" } else { "preparing" }.into();
            s.failure = None;
            s.completed = "0".into();
        });
        let kernel = self.kernel.clone();
        let (ids, boundary) = self
            .db(move |c| {
                Box::pin(async move {
                    let boundary = journal::boundary(c).await?;
                    let ids = kernel.entity_ids_in(c).await?;
                    Ok((ids, boundary))
                })
            })
            .await?;
        if boundary.identity != identity {
            return Err(SearchError::Invalid("library identity changed".into()));
        }
        self.status(|s| s.total = Some(ids.len().to_string()));
        #[cfg(test)]
        {
            let pause = self
                .shared
                .build_pause
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .take();
            if let Some((entered, release)) = pause {
                entered.notify_one();
                release.notified().await;
            }
        }
        self.check_stop()?;
        let generation = uuid::Uuid::now_v7().to_string();
        let path = self.root.join(&generation);
        std::fs::create_dir_all(&path)?;
        let index = Index::create_in_dir(&path, self.mapping.schema.clone())?;
        self.mapping.configure(&index);
        let mut writer = self.writer(&index)?;
        let mut completed = 0;
        for chunk in ids.as_bytes().chunks(16 * 256) {
            self.check_stop()?;
            let entities = chunk
                .chunks_exact(16)
                .map(|b| EntityId::from_bytes(b).map_err(|e| SearchError::Invalid(e.to_string())))
                .collect::<Result<Vec<_>, _>>()?;
            let providers = self.providers.clone();
            let kernel = self.kernel.clone();
            let projected = self
                .db(move |c| {
                    Box::pin(async move { providers.project(c, &kernel, &entities).await })
                })
                .await?;
            let documents = projected
                .into_iter()
                .filter_map(|(id, p)| p.map(|p| self.mapping.document(id, &p)))
                .collect::<Result<Vec<_>, _>>()?;
            for document in documents {
                writer.get()?.add_document(document)?;
            }
            completed += chunk.len() / 16;
            self.status(|s| s.completed = completed.to_string());
        }
        let checkpoint = Checkpoint {
            identity: identity.into(),
            fingerprint: self.mapping.fingerprint.clone(),
            generation,
            covered: boundary.head,
        };
        self.commit(&mut writer, &checkpoint)?;
        drop(writer);
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;
        let publication = self
            .catch_up(Publication {
                _lease: self.lease(&checkpoint.generation),
                index,
                reader,
                checkpoint,
            })
            .await?;
        // A pointer is only written after a complete durable generation. If interrupted
        // between removal and rename, startup rebuilds; an acknowledgement never certifies it.
        let next = self.root.join("current.next");
        std::fs::write(&next, &publication.checkpoint.generation)?;
        let pointer = self.root.join("current");
        if pointer.exists() {
            std::fs::remove_file(&pointer)?;
        }
        std::fs::rename(next, pointer)?;
        let covered = publication.checkpoint.covered;
        self.db(move |c| Box::pin(journal::acknowledge(c, covered)))
            .await?;
        Ok(publication)
    }
    async fn catch_up(&self, mut publication: Publication) -> Result<Publication, SearchError> {
        loop {
            self.check_stop()?;
            let after = publication.checkpoint.covered;
            let providers = self.providers.clone();
            let kernel = self.kernel.clone();
            let (covered, projected, head) = self
                .db(move |c| {
                    Box::pin(async move {
                        let (covered, ids) = journal::pending(c, after).await?;
                        let values = providers.project(c, &kernel, &ids).await?;
                        Ok((covered, values, journal::boundary(c).await?.head))
                    })
                })
                .await?;
            self.status(|s| {
                s.journal_head = head.to_string();
                if covered > after && s.usable {
                    s.state = "pending".into();
                }
            });
            if covered == after {
                break;
            }
            let documents = projected
                .into_iter()
                .map(|(id, p)| Ok((id, p.map(|p| self.mapping.document(id, &p)).transpose()?)))
                .collect::<Result<Vec<(EntityId, Option<TantivyDocument>)>, SearchError>>()?;
            let mut writer = self.writer(&publication.index)?;
            for (id, document) in documents {
                writer
                    .get()?
                    .delete_term(Term::from_field_text(self.mapping.id, &id.to_string()));
                if let Some(document) = document {
                    writer.get()?.add_document(document)?;
                }
            }
            let mut checkpoint = publication.checkpoint.clone();
            checkpoint.covered = covered;
            self.commit(&mut writer, &checkpoint)?;
            drop(writer);
            // Reader publication is separate from durable commit and SQLite acknowledgement.
            // A failed reload leaves shared publication untouched. Retry reopens durable state.
            #[cfg(test)]
            self.fault(3)?;
            let reader = publication
                .index
                .reader_builder()
                .reload_policy(ReloadPolicy::Manual)
                .try_into()?;
            publication.reader = reader;
            publication.checkpoint = checkpoint;
            #[cfg(test)]
            self.fault(4)?;
            self.db(move |c| Box::pin(journal::acknowledge(c, covered)))
                .await?;
            if covered >= head {
                break;
            }
        }
        Ok(publication)
    }
    pub(super) fn publish(&self, publication: Publication) {
        let checkpoint = publication.checkpoint.clone();
        *self
            .shared
            .publication
            .write()
            .unwrap_or_else(|e| e.into_inner()) = Some(publication);
        self.status(|s| {
            s.state = "ready".into();
            s.usable = true;
            s.generation = Some(checkpoint.generation);
            s.covered_sequence = checkpoint.covered.to_string();
            s.failure = None;
            s.total = None;
        });
    }
}
