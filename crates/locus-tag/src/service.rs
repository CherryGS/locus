use crate::{
    error::TagError,
    identity::{TAG_SET_KIND, TagId},
    persistence,
    record::{TagRecord, TagSetRecord},
    view::TagDocument,
};
use diesel::{
    sql_query,
    sql_types::{Binary, Nullable, Text},
};
use diesel_async::RunQueryDsl;
use locus_core::api::{ComponentId, EntityId, Kernel, Membership};
use locus_store::api::Context;
#[derive(Clone, Copy, Default)]
pub struct TagService;
fn name(input: &str) -> Result<&str, TagError> {
    let n = input.trim();
    if n.is_empty() {
        Err(TagError::BlankName)
    } else {
        Ok(n)
    }
}
impl TagService {
    pub async fn list_in(c: &mut Context) -> Result<Vec<TagRecord>, TagError> {
        persistence::list(c).await
    }
    pub async fn read_in(c: &mut Context, id: TagId) -> Result<TagRecord, TagError> {
        persistence::read(c, id).await
    }
    pub async fn read_document_in(c: &mut Context, id: TagId) -> Result<TagDocument, TagError> {
        persistence::document(c, id).await
    }
    pub async fn save_markdown_in(
        c: &mut Context,
        id: TagId,
        revision: &str,
        markdown: &str,
    ) -> Result<TagRecord, TagError> {
        let document = persistence::document(c, id).await?;
        let mut tag = document.tag;
        if tag.revision != revision {
            return Err(TagError::Conflict);
        }
        if document.markdown == markdown {
            return Ok(tag);
        }
        tag.revision = uuid::Uuid::now_v7().to_string();
        sql_query("UPDATE locus_tag_comm_tag SET markdown=?,revision=? WHERE id=?")
            .bind::<Text, _>(markdown)
            .bind::<Text, _>(&tag.revision)
            .bind::<Binary, _>(id.as_bytes().as_slice())
            .execute(c.connection())
            .await?;
        Ok(tag)
    }
    pub async fn read_set_in(c: &mut Context, id: ComponentId) -> Result<TagSetRecord, TagError> {
        Ok(TagSetRecord {
            id,
            tags: persistence::set(c, id).await?,
        })
    }
    pub async fn entity_in(
        k: &Kernel,
        c: &mut Context,
        entity: EntityId,
    ) -> Result<Option<TagSetRecord>, TagError> {
        match k
            .memberships_in(c, entity)
            .await?
            .into_iter()
            .find(|m| m.kind == TAG_SET_KIND)
        {
            Some(m) => Ok(Some(Self::read_set_in(c, m.component).await?)),
            None => Ok(None),
        }
    }
    pub async fn create_in(c: &mut Context, input: &str) -> Result<TagRecord, TagError> {
        Self::create_under_in(c, input, None).await
    }
    pub async fn create_under_in(
        c: &mut Context,
        input: &str,
        parent: Option<TagId>,
    ) -> Result<TagRecord, TagError> {
        let name = name(input)?;
        if let Some(parent) = parent {
            persistence::read(c, parent).await?;
        }
        persistence::available(c, name, None).await?;
        let record = TagRecord {
            id: TagId::new(),
            parent,
            name: name.into(),
            revision: uuid::Uuid::now_v7().to_string(),
        };
        sql_query("INSERT INTO locus_tag_comm_tag(id,name,revision,parent) VALUES(?,?,?,?)")
            .bind::<Binary, _>(record.id.as_bytes().as_slice())
            .bind::<Text, _>(&record.name)
            .bind::<Text, _>(&record.revision)
            .bind::<Nullable<Binary>, _>(parent.map(|id| id.as_bytes().to_vec()))
            .execute(c.connection())
            .await?;
        Ok(record)
    }
    pub async fn rename_in(
        c: &mut Context,
        id: TagId,
        revision: &str,
        input: &str,
    ) -> Result<TagRecord, TagError> {
        let mut record = persistence::read(c, id).await?;
        if record.revision != revision {
            return Err(TagError::Conflict);
        };
        let name = name(input)?;
        persistence::available(c, name, Some(id)).await?;
        if record.name == name {
            return Ok(record);
        }
        record.name = name.into();
        record.revision = uuid::Uuid::now_v7().to_string();
        sql_query("UPDATE locus_tag_comm_tag SET name=?,revision=? WHERE id=?")
            .bind::<Text, _>(&record.name)
            .bind::<Text, _>(&record.revision)
            .bind::<Binary, _>(id.as_bytes().as_slice())
            .execute(c.connection())
            .await?;
        Ok(record)
    }
    pub async fn delete_in(c: &mut Context, id: TagId, revision: &str) -> Result<(), TagError> {
        let revision = revision.to_owned();
        c.savepoint(move |c| {
            Box::pin(async move {
                let record = persistence::read(c, id).await?;
                if record.revision != revision {
                    return Err(TagError::Conflict);
                }
                let forest = persistence::list(c).await?;
                for child in forest.iter().filter(|r| r.parent == Some(id)) {
                    crate::hierarchy::set_parent(c, child.id, record.parent).await?;
                }
                // Cascading assignment deletion also covers retained, unmounted sets.
                sql_query("DELETE FROM locus_tag_comm_tag WHERE id=?")
                    .bind::<Binary, _>(id.as_bytes().as_slice())
                    .execute(c.connection())
                    .await?;
                Ok(())
            })
        })
        .await
    }
    pub async fn move_in(
        c: &mut Context,
        id: TagId,
        revision: &str,
        parent: Option<TagId>,
    ) -> Result<TagRecord, TagError> {
        let forest = persistence::list(c).await?;
        let record = forest
            .iter()
            .find(|r| r.id == id)
            .ok_or(TagError::MissingTag)?;
        if record.revision != revision {
            return Err(TagError::Conflict);
        }
        let parents: std::collections::HashMap<_, _> =
            forest.iter().map(|r| (r.id, r.parent)).collect();
        let mut ancestor = parent;
        while let Some(target) = ancestor {
            if target == id {
                return Err(TagError::InvalidParent);
            }
            ancestor = *parents.get(&target).ok_or(TagError::MissingTag)?;
        }
        if record.parent == parent {
            return Ok(record.clone());
        }
        crate::hierarchy::set_parent(c, id, parent).await?;
        persistence::read(c, id).await
    }
    pub async fn subtree_in(c: &mut Context, root: TagId) -> Result<Vec<TagId>, TagError> {
        crate::hierarchy::subtree(c, root).await
    }
    /// The savepoint keeps first-set creation/admission/attachment atomic even when the caller handles an error.
    pub async fn add_in(
        k: &Kernel,
        c: &mut Context,
        entity: EntityId,
        tag: TagId,
    ) -> Result<bool, TagError> {
        let k = k.clone();
        c.savepoint(move |c| {
            Box::pin(async move {
                let current = Self::entity_in(&k, c, entity).await?;
                persistence::read(c, tag).await?;
                let id = if let Some(set) = current {
                    if set.tags.iter().any(|t| t.id == tag) {
                        return Ok(false);
                    };
                    set.id
                } else {
                    let id = ComponentId::new();
                    sql_query("INSERT INTO locus_tag_comp_set(id) VALUES(?)")
                        .bind::<Binary, _>(id.as_bytes().as_slice())
                        .execute(c.connection())
                        .await?;
                    k.admit_component_in(c, TAG_SET_KIND, id).await?;
                    k.attach_in(
                        c,
                        Membership {
                            entity,
                            kind: TAG_SET_KIND,
                            component: id,
                        },
                    )
                    .await?;
                    id
                };
                sql_query("INSERT INTO locus_tag_rela_assignment(tag_set,tag) VALUES(?,?)")
                    .bind::<Binary, _>(id.as_bytes().as_slice())
                    .bind::<Binary, _>(tag.as_bytes().as_slice())
                    .execute(c.connection())
                    .await?;
                Ok(true)
            })
        })
        .await
    }
    pub async fn remove_in(
        k: &Kernel,
        c: &mut Context,
        entity: EntityId,
        tag: TagId,
    ) -> Result<bool, TagError> {
        let Some(set) = Self::entity_in(k, c, entity).await? else {
            return Ok(false);
        };
        Ok(
            sql_query("DELETE FROM locus_tag_rela_assignment WHERE tag_set=? AND tag=?")
                .bind::<Binary, _>(set.id.as_bytes().as_slice())
                .bind::<Binary, _>(tag.as_bytes().as_slice())
                .execute(c.connection())
                .await?
                != 0,
        )
    }
}
