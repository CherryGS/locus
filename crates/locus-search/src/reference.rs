use crate::{error::SearchError, schema::Mapping};
use locus_query::api::{Catalogue, Condition, ReferenceOperand, Value};
use std::collections::{BTreeMap, BTreeSet};
use tantivy::{
    query::{ConstScoreQuery, EmptyQuery, Query, TermSetQuery},
    query_grammar::{UserInputAst as Ast, UserInputLeaf as Leaf},
};

pub(crate) type Bindings = BTreeMap<ReferenceOperand, Vec<String>>;
pub(crate) fn leaf(
    leaf: &Leaf,
    catalogue: &Catalogue,
) -> Result<Option<ReferenceOperand>, SearchError> {
    let name = match leaf {
        Leaf::Literal(l) => l.field_name.as_deref(),
        Leaf::Exists { field } => Some(field.as_str()),
        Leaf::Range { field, .. } | Leaf::Set { field, .. } | Leaf::Regex { field, .. } => {
            field.as_deref()
        }
        _ => None,
    };
    let Some(name) = name else {
        return Ok(None);
    };
    if !catalogue.references.iter().any(|r| r.id == name) {
        return Ok(None);
    }
    let Leaf::Literal(literal) = leaf else {
        return Err(SearchError::Native(format!(
            "{name} accepts one UUID literal only"
        )));
    };
    if literal.prefix || literal.slop != 0 {
        return Err(SearchError::Native(format!(
            "{name} does not support prefix or proximity operators"
        )));
    }
    let operand = ReferenceOperand {
        reference: name.into(),
        identity: literal.phrase.clone(),
    };
    operand.validate(catalogue)?;
    Ok(Some(operand.normalized()?))
}
pub(crate) fn collect_native(
    ast: &Ast,
    catalogue: &Catalogue,
    roots: &mut BTreeSet<ReferenceOperand>,
) -> Result<(), SearchError> {
    match ast {
        Ast::Boost(child, _) => collect_native(child, catalogue, roots)?,
        Ast::Clause(children) => {
            for (_, child) in children {
                collect_native(child, catalogue, roots)?;
            }
        }
        Ast::Leaf(input) => {
            if let Some(operand) = leaf(input, catalogue)? {
                roots.insert(operand);
            }
        }
    }
    Ok(())
}
pub(crate) fn collect_typed(
    condition: &Condition,
    catalogue: &Catalogue,
    roots: &mut BTreeSet<ReferenceOperand>,
) -> Result<(), SearchError> {
    condition.validate(catalogue)?;
    match condition {
        Condition::Reference(operand) => {
            roots.insert(operand.normalized()?);
        }
        Condition::And(children) | Condition::Or(children) => {
            for child in children {
                collect_typed(child, catalogue, roots)?;
            }
        }
        Condition::Not(child) => collect_typed(child, catalogue, roots)?,
        Condition::Predicate(_) => (),
    }
    Ok(())
}
/// None is an explicit analysis-only compilation; execution always supplies captured bindings.
pub(crate) fn query(
    operand: &ReferenceOperand,
    m: &Mapping,
    bindings: Option<&Bindings>,
) -> Result<Box<dyn Query>, SearchError> {
    operand.validate(&m.catalogue)?;
    let Some(bindings) = bindings else {
        return Ok(Box::new(EmptyQuery));
    };
    let identities = bindings.get(&operand.normalized()?).ok_or_else(|| {
        SearchError::Invalid(format!(
            "unresolved query reference {} {}",
            operand.reference, operand.identity
        ))
    })?;
    let field = &m.catalogue.reference(&operand.reference)?.target_field;
    let terms = identities
        .iter()
        .map(|id| crate::compiler::term(m, field, &Value::Identifier(id.clone())))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Box::new(ConstScoreQuery::new(
        Box::new(TermSetQuery::new(terms)),
        0.0,
    )))
}

/// Primary reference vocabulary bypasses the index maintenance command loop.
/// It still participates in the same task-bound database exclusion and library lifetime.
#[derive(Clone)]
pub(crate) struct ReferenceReader {
    pub providers: crate::projection::Providers,
    pub queue: locus_task::api::TaskQueue,
    pub database: locus_store::api::TaskDatabase,
    pub lifetime: std::sync::Arc<dyn Send + Sync>,
}
impl ReferenceReader {
    pub async fn choices(
        &self,
        reference: String,
    ) -> Result<Vec<locus_query::api::ReferenceChoice>, SearchError> {
        let reader = self.clone();
        self.queue
            .submit(
                "Read primary query reference choices",
                move |task| async move {
                    let _lifetime = reader.lifetime;
                    let mut session = reader.database.session(&task).await?;
                    session
                        .transaction(move |c| {
                            Box::pin(async move { reader.providers.choices(c, &reference).await })
                        })
                        .await
                },
            )?
            .result()
            .await?
    }
}
