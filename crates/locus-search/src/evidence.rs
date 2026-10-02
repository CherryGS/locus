use crate::{compiler, error::SearchError, service::SearchService};
use locus_core::api::EntityId;
use serde::{Deserialize, Serialize};
use tantivy::{
    DocAddress, Searcher, Term,
    collector::TopDocs,
    query::{Query, TermQuery},
    schema::IndexRecordOption,
};
#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Evidence {
    pub entity: String,
    pub matches: Vec<MatchEvidence>,
}
#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
pub struct MatchEvidence {
    pub field: Option<String>,
    pub component: Option<String>,
    pub condition: Option<String>,
    pub role: String,
    pub range: Option<locus_query::api::SourceRange>,
}
fn matches(
    query: &dyn Query,
    searcher: &Searcher,
    address: DocAddress,
) -> Result<bool, SearchError> {
    let reader = searcher.segment_reader(address.segment_ord);
    let weight = query.weight(tantivy::query::EnableScoring::disabled_from_searcher(
        searcher,
    ))?;
    let mut scorer = weight.scorer(reader, 1.0)?;
    Ok(scorer.doc() <= address.doc_id
        && scorer.seek(address.doc_id) == address.doc_id
        && reader
            .alive_bitset()
            .is_none_or(|a| a.is_alive(address.doc_id)))
}
impl SearchService {
    pub fn evidence(&self, id: &str, entities: &[EntityId]) -> Result<Vec<Evidence>, SearchError> {
        if entities.len() > 128 {
            return Err(SearchError::Request(
                "evidence accepts at most 128 Entities".into(),
            ));
        }
        let context = self.context(id)?;
        let original = if let Some(program) = &context.program {
            compiler::program_bound(
                &context.publication.index,
                &self.mapping,
                program,
                Some(&context.bindings),
            )?
        } else {
            compiler::compile_bound(
                &context.publication.index,
                &self.mapping,
                &self.catalogue,
                &context.request.text,
                context.request.filter.as_ref(),
                &context.bindings,
            )?
        };
        let mut result = Vec::new();
        for entity in entities {
            let identity = TermQuery::new(
                Term::from_field_text(self.mapping.id, &entity.to_string()),
                IndexRecordOption::Basic,
            );
            let docs = context
                .searcher
                .search(&identity, &TopDocs::with_limit(2).order_by_score())?;
            if docs.len() != 1 || !matches(&*original, &context.searcher, docs[0].1)? {
                return Err(SearchError::Request(format!(
                    "Entity {entity} was not a result"
                )));
            }
            let mut output = Vec::new();
            if let Some(program) = &context.program {
                output.push(MatchEvidence {
                    field: None,
                    component: None,
                    condition: Some(program.source.text.clone()),
                    role: "required".into(),
                    range: Some(locus_query::api::SourceRange {
                        start: 0,
                        end: program.source.text.len(),
                    }),
                });
            } else {
                if !context.request.text.trim().is_empty() {
                    output.push(MatchEvidence {
                        field: None,
                        component: None,
                        condition: Some(context.request.text.clone()),
                        role: "required".into(),
                        range: None,
                    });
                }
                if let Some(condition) = &context.request.filter {
                    self.typed_evidence(condition, &context, docs[0].1, "required", &mut output)?;
                }
            }
            result.push(Evidence {
                entity: entity.to_string(),
                matches: output,
            });
        }
        Ok(result)
    }
    fn typed_evidence(
        &self,
        condition: &locus_query::api::Condition,
        context: &crate::service::QueryContext,
        address: DocAddress,
        role: &str,
        out: &mut Vec<MatchEvidence>,
    ) -> Result<(), SearchError> {
        use locus_query::api::Condition;
        if !matches(
            &*compiler::condition_bound(condition, &self.mapping, Some(&context.bindings))?,
            &context.searcher,
            address,
        )? {
            return Ok(());
        }
        match condition {
            Condition::And(children) | Condition::Or(children) => {
                for child in children {
                    self.typed_evidence(
                        child,
                        context,
                        address,
                        if matches!(condition, Condition::Or(_)) {
                            "alternative"
                        } else {
                            role
                        },
                        out,
                    )?;
                }
            }
            Condition::Not(_) | Condition::Predicate(_) | Condition::Reference(_) => {
                out.push(MatchEvidence {
                    field: if let Condition::Predicate(p) = condition {
                        Some(p.field.clone())
                    } else {
                        None
                    },
                    component: None,
                    condition: Some(serde_json::to_string(condition)?),
                    role: if matches!(condition, Condition::Not(_)) {
                        "complement".into()
                    } else {
                        role.into()
                    },
                    range: None,
                })
            }
        }
        Ok(())
    }
}
