use crate::{error::SearchError, schema::Mapping};
use locus_query::api::{Catalogue, Condition, Operation, Predicate, Value};
use std::ops::Bound;
use tantivy::{
    Index, Term,
    query::{AllQuery, BooleanQuery, BoostQuery, Occur, Query, QueryParser, RangeQuery, TermQuery},
    schema::{Field, IndexRecordOption},
};
pub(crate) fn term(field: Field, value: &Value) -> Result<Term, SearchError> {
    Ok(match value {
        Value::Identifier(v) | Value::Text(v) => Term::from_field_text(field, v),
        Value::Uint(v) => Term::from_field_u64(
            field,
            v.parse()
                .map_err(|_| SearchError::Invalid("uint operand".into()))?,
        ),
        Value::Int(v) | Value::Time(v) => Term::from_field_i64(
            field,
            v.parse()
                .map_err(|_| SearchError::Invalid("integer operand".into()))?,
        ),
        Value::Float(v) => Term::from_field_f64(field, *v),
    })
}
fn exact(term: Term) -> Box<dyn Query> {
    Box::new(TermQuery::new(term, IndexRecordOption::Basic))
}
pub(crate) fn and(queries: Vec<Box<dyn Query>>) -> Box<dyn Query> {
    Box::new(BooleanQuery::new(
        queries.into_iter().map(|q| (Occur::Must, q)).collect(),
    ))
}
fn or(queries: Vec<Box<dyn Query>>) -> Box<dyn Query> {
    Box::new(BooleanQuery::new(
        queries.into_iter().map(|q| (Occur::Should, q)).collect(),
    ))
}
fn not(query: Box<dyn Query>) -> Box<dyn Query> {
    Box::new(BooleanQuery::new(vec![
        (Occur::Must, Box::new(AllQuery)),
        (Occur::MustNot, query),
    ]))
}
pub(crate) fn predicate(p: &Predicate, mapping: &Mapping) -> Result<Box<dyn Query>, SearchError> {
    let (_, state, field) = mapping.fields[&p.field];
    let state_query = |value: &str| exact(Term::from_field_text(state, value));
    let present = || or(vec![state_query("value"), state_query("empty")]);
    let equality = |value: &Value| -> Result<Box<dyn Query>, SearchError> {
        if matches!(value,Value::Text(s)|Value::Identifier(s) if s.is_empty()) {
            Ok(state_query("empty"))
        } else {
            Ok(exact(term(field, value)?))
        }
    };
    Ok(match p.operation {
        Operation::Missing => state_query("missing"),
        Operation::Empty => state_query("empty"),
        Operation::Present => present(),
        Operation::Eq => and(vec![present(), equality(&p.values[0])?]),
        Operation::Ne => and(vec![present(), not(equality(&p.values[0])?)]),
        Operation::Any | Operation::All | Operation::None => {
            let terms = p
                .values
                .iter()
                .map(|v| Ok(exact(term(field, v)?)))
                .collect::<Result<Vec<_>, SearchError>>()?;
            let query = match p.operation {
                Operation::All => and(terms),
                Operation::None => not(or(terms)),
                _ => or(terms),
            };
            and(vec![present(), query])
        }
        operation => {
            let value = term(field, &p.values[0])?;
            let (lower, upper) = match operation {
                Operation::Lt => (Bound::Unbounded, Bound::Excluded(value)),
                Operation::Le => (Bound::Unbounded, Bound::Included(value)),
                Operation::Gt => (Bound::Excluded(value), Bound::Unbounded),
                Operation::Ge => (Bound::Included(value), Bound::Unbounded),
                _ => return Err(SearchError::Invalid("range operation".into())),
            };
            and(vec![
                state_query("value"),
                Box::new(RangeQuery::new(lower, upper)),
            ])
        }
    })
}
pub(crate) fn condition(c: &Condition, m: &Mapping) -> Result<Box<dyn Query>, SearchError> {
    Ok(match c {
        Condition::And(children) => and(children
            .iter()
            .map(|c| condition(c, m))
            .collect::<Result<_, _>>()?),
        Condition::Or(children) => or(children
            .iter()
            .map(|c| condition(c, m))
            .collect::<Result<_, _>>()?),
        Condition::Not(child) => not(condition(child, m)?),
        Condition::Predicate(p) => predicate(p, m)?,
    })
}
pub(crate) fn compile(
    index: &Index,
    m: &Mapping,
    catalogue: &Catalogue,
    text: &str,
    filter: Option<&Condition>,
) -> Result<Box<dyn Query>, SearchError> {
    if !text.trim().is_empty() {
        let ast = tantivy::query_grammar::parse_query(text)
            .map_err(|e| SearchError::Native(format!("{e:?}")))?;
        validate_native(&ast, catalogue)?;
    }
    let native: Box<dyn Query> = if text.trim().is_empty() {
        Box::new(AllQuery)
    } else {
        QueryParser::for_index(index, m.defaults.clone())
            .parse_query(text)
            .map_err(|e| SearchError::Native(e.to_string()))?
    };
    if let Some(filter) = filter {
        filter.validate(catalogue)?;
        Ok(and(vec![
            native,
            Box::new(BoostQuery::new(condition(filter, m)?, 0.0)),
        ]))
    } else {
        Ok(native)
    }
}

fn validate_native(
    ast: &tantivy::query_grammar::UserInputAst,
    catalogue: &Catalogue,
) -> Result<(), SearchError> {
    use tantivy::query_grammar::{UserInputAst as A, UserInputLeaf as L};
    match ast {
        A::Clause(children) => {
            for (_, child) in children {
                validate_native(child, catalogue)?;
            }
        }
        A::Boost(child, _) => validate_native(child, catalogue)?,
        A::Leaf(leaf) => {
            let field = match &**leaf {
                L::Literal(l) => l.field_name.as_deref(),
                L::Range { field, .. } | L::Set { field, .. } | L::Regex { field, .. } => {
                    field.as_deref()
                }
                L::Exists { field } => Some(field.as_str()),
                L::All => None,
            };
            if let Some(field) = field
                && !catalogue.fields.iter().any(|f| {
                    f.native_value == field || f.native_state == field || f.native_exact == field
                })
            {
                return Err(SearchError::Native(format!("undeclared field {field}")));
            }
        }
    }
    Ok(())
}
