use crate::{
    compiler,
    error::SearchError,
    service::{QueryContext, SearchService},
};
use locus_core::api::EntityId;
use locus_query::api::{Condition, FieldValue, Operation, ValueState};
use serde::{Deserialize, Serialize};
use tantivy::{
    DocAddress, Searcher, TantivyDocument, Term,
    collector::TopDocs,
    query::{Query, QueryParser, TermQuery},
    query_grammar::{UserInputAst, UserInputLeaf},
    schema::{IndexRecordOption, Value as _},
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
    pub fn evidence(
        &self,
        context: &str,
        entities: &[EntityId],
    ) -> Result<Vec<Evidence>, SearchError> {
        if entities.len() > 128 {
            return Err(SearchError::Request(
                "evidence accepts at most 128 Entities".into(),
            ));
        }
        let context = self.context(context)?;
        let original = compiler::compile(
            &context.publication.index,
            &self.mapping,
            &self.catalogue,
            &context.request.text,
            context.request.filter.as_ref(),
        )?;
        let mut result = Vec::new();
        for entity in entities {
            let identity = TermQuery::new(
                Term::from_field_text(self.mapping.id, &entity.to_string()),
                IndexRecordOption::Basic,
            );
            let documents = context
                .searcher
                .search(&identity, &TopDocs::with_limit(2).order_by_score())?;
            if documents.len() > 1 {
                return Err(SearchError::Invalid("duplicate indexed Entity".into()));
            }
            let Some((_, address)) = documents.first().copied() else {
                return Err(SearchError::Request(format!(
                    "Entity {entity} was not a result"
                )));
            };
            if !matches(&*original, &context.searcher, address)? {
                return Err(SearchError::Request(format!(
                    "Entity {entity} was not a result"
                )));
            }
            let doc: TantivyDocument = context.searcher.doc(address)?;
            let bytes = doc
                .get_first(self.mapping.evidence)
                .and_then(|v| v.as_bytes())
                .ok_or_else(|| SearchError::Invalid("missing evidence projection".into()))?;
            let values: Vec<FieldValue> = serde_json::from_slice(bytes)?;
            let mut evidence = Vec::new();
            if let Some(filter) = &context.request.filter {
                self.filter_evidence(filter, &context, address, &values, &mut evidence)?;
            }
            if !context.request.text.trim().is_empty() {
                let ast = tantivy::query_grammar::parse_query(&context.request.text)
                    .map_err(|e| SearchError::Native(format!("{e:?}")))?;
                self.native_evidence(&ast, &context, address, &values, &mut evidence)?;
            }
            result.push(Evidence {
                entity: entity.to_string(),
                matches: evidence,
            });
        }
        Ok(result)
    }
    fn filter_evidence(
        &self,
        condition: &Condition,
        context: &QueryContext,
        address: DocAddress,
        values: &[FieldValue],
        output: &mut Vec<MatchEvidence>,
    ) -> Result<(), SearchError> {
        if !matches(
            &*compiler::condition(condition, &self.mapping)?,
            &context.searcher,
            address,
        )? {
            return Ok(());
        }
        match condition {
            Condition::And(children) | Condition::Or(children) => {
                for child in children {
                    self.filter_evidence(child, context, address, values, output)?;
                }
            }
            Condition::Not(_) => output.push(MatchEvidence {
                field: None,
                component: None,
                condition: Some(serde_json::to_string(condition)?),
            }),
            Condition::Predicate(p) => {
                let component = if matches!(p.operation, Operation::Missing) {
                    None
                } else {
                    values
                        .iter()
                        .find(|v| v.field == p.field)
                        .and_then(|v| v.component.clone())
                };
                output.push(MatchEvidence {
                    field: Some(p.field.clone()),
                    component,
                    condition: Some(serde_json::to_string(condition)?),
                });
            }
        }
        Ok(())
    }
    fn native_evidence(
        &self,
        ast: &UserInputAst,
        context: &QueryContext,
        address: DocAddress,
        values: &[FieldValue],
        output: &mut Vec<MatchEvidence>,
    ) -> Result<(), SearchError> {
        let parser =
            QueryParser::for_index(&context.publication.index, self.mapping.defaults.clone());
        let query = parser
            .build_query_from_user_input_ast(ast.clone())
            .map_err(|e| SearchError::Native(e.to_string()))?;
        if !matches(&*query, &context.searcher, address)? {
            return Ok(());
        }
        match ast {
            UserInputAst::Boost(child, _) => {
                self.native_evidence(child, context, address, values, output)?
            }
            UserInputAst::Clause(children) => {
                for (occur, child) in children {
                    if *occur == Some(tantivy::query_grammar::Occur::MustNot) {
                        output.push(MatchEvidence {
                            field: None,
                            component: None,
                            condition: Some(format!("NOT {child:?}")),
                        });
                    } else {
                        self.native_evidence(child, context, address, values, output)?;
                    }
                }
            }
            UserInputAst::Leaf(leaf) => {
                let field = match &**leaf {
                    UserInputLeaf::Literal(l) => l.field_name.clone(),
                    UserInputLeaf::Range { field, .. }
                    | UserInputLeaf::Set { field, .. }
                    | UserInputLeaf::Regex { field, .. } => field.clone(),
                    UserInputLeaf::Exists { field } => Some(field.clone()),
                    UserInputLeaf::All => None,
                };
                if matches!(&**leaf, UserInputLeaf::All) {
                    output.push(MatchEvidence {
                        field: None,
                        component: None,
                        condition: Some("*".into()),
                    });
                    return Ok(());
                }
                let fields = if let Some(field) = field {
                    vec![field]
                } else {
                    self.catalogue
                        .fields
                        .iter()
                        .filter(|f| f.default_text)
                        .map(|f| f.id.clone())
                        .collect()
                };
                for field in fields {
                    let mut selected = leaf.clone();
                    match &mut *selected {
                        UserInputLeaf::Literal(l) => l.field_name = Some(field.clone()),
                        UserInputLeaf::Range { field: f, .. }
                        | UserInputLeaf::Set { field: f, .. }
                        | UserInputLeaf::Regex { field: f, .. } => *f = Some(field.clone()),
                        _ => (),
                    }
                    let query = parser
                        .build_query_from_user_input_ast(UserInputAst::Leaf(selected))
                        .map_err(|e| SearchError::Native(e.to_string()))?;
                    if matches(&*query, &context.searcher, address)? {
                        let definition = self.catalogue.fields.iter().find(|f| {
                            f.native_value == field
                                || f.native_state == field
                                || f.native_exact == field
                        });
                        let Some(definition) = definition else {
                            continue;
                        };
                        let projection = values.iter().find(|v| v.field == definition.id);
                        let component = projection
                            .filter(|v| !matches!(v.value, ValueState::Missing))
                            .and_then(|v| v.component.clone());
                        output.push(MatchEvidence {
                            field: Some(definition.id.clone()),
                            component,
                            condition: Some(format!("{leaf:?}")),
                        });
                    }
                }
            }
        }
        Ok(())
    }
}
