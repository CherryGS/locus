use crate::{error::SearchError, schema::Mapping};
use locus_query::api::{Catalogue, Condition, FieldType, Operation, Predicate, Program, Value};
use std::ops::Bound;
use tantivy::{
    Index, Term,
    query::{
        AllQuery, BooleanQuery, BoostQuery, ConstScoreQuery, EmptyQuery, Occur, Query, QueryParser,
        RangeQuery, TermQuery, TermSetQuery,
    },
    query_grammar::{UserInputAst as Ast, UserInputLeaf as Leaf},
    schema::IndexRecordOption,
};

fn parser(index: &Index, m: &Mapping) -> QueryParser {
    let mut parser = QueryParser::for_index(index, m.defaults.clone());
    parser.allow_regexes();
    parser
}
fn regex_query(
    m: &Mapping,
    field: &str,
    analyzed: bool,
    pattern: &str,
) -> Result<Box<dyn Query>, SearchError> {
    let mapped = if analyzed { m.text } else { m.values };
    let mut prefix = Term::from_field_json_path(mapped, field, false);
    prefix.append_type_and_str("");
    let prefix = prefix
        .serialized_value_bytes()
        .iter()
        .map(|b| format!("\\x{b:02x}"))
        .collect::<String>();
    Ok(Box::new(
        tantivy::query::RegexQuery::from_pattern(&format!("{prefix}(?:{pattern})"), mapped)
            .map_err(|e| SearchError::Native(e.to_string()))?,
    ))
}
fn regex_escape(value: &str) -> String {
    let mut pattern = String::new();
    for c in value.chars() {
        if ".*+?()[]{}|^$\\".contains(c) {
            pattern.push('\\');
        }
        pattern.push(c);
    }
    pattern
}
fn exact(term: Term) -> Box<dyn Query> {
    Box::new(TermQuery::new(term, IndexRecordOption::Basic))
}
fn with_original(
    m: &Mapping,
    field: &str,
    matcher: crate::original::Match,
    native: Box<dyn Query>,
) -> Box<dyn Query> {
    or(vec![
        and(vec![
            native,
            not(exact(Term::from_field_text(m.oversized, field))),
        ]),
        Box::new(crate::original::OriginalQuery {
            values: m.values,
            marker: m.oversized,
            field: field.into(),
            matcher,
            native: None,
        }),
    ])
}
fn long_equality(m: &Mapping, field: &str, value: &str, scoring: bool) -> Box<dyn Query> {
    let mut lookup = Term::from_field_json_path(m.lookup, field, false);
    lookup.append_type_and_str(&crate::original::lookup(value));
    Box::new(crate::original::OriginalQuery {
        values: m.values,
        marker: m.oversized,
        field: field.into(),
        matcher: crate::original::Match::Equal(value.into()),
        native: Some(Box::new(TermQuery::new(
            lookup,
            if scoring {
                IndexRecordOption::WithFreqs
            } else {
                IndexRecordOption::Basic
            },
        ))),
    })
}
fn equality_term(m: &Mapping, field: &str, value: &Value) -> Result<Box<dyn Query>, SearchError> {
    let native = exact(term(m, field, value)?);
    Ok(match value {
        Value::Text(s) | Value::Identifier(s) if s.len() > crate::original::MAX_TERM_BYTES => {
            long_equality(m, field, s, false)
        }
        _ => native,
    })
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
    Box::new(ConstScoreQuery::new(
        Box::new(BooleanQuery::new(vec![
            (Occur::Must, Box::new(AllQuery)),
            (Occur::MustNot, query),
        ])),
        0.0,
    ))
}
pub(crate) fn presence(m: &Mapping, field: &str) -> Box<dyn Query> {
    Box::new(ConstScoreQuery::new(
        exact(Term::from_field_text(m.presence, field)),
        1.0,
    ))
}
pub(crate) fn term(m: &Mapping, field: &str, value: &Value) -> Result<Term, SearchError> {
    let mut term = Term::from_field_json_path(m.values, field, false);
    match value {
        Value::Identifier(v) | Value::Text(v) => term.append_type_and_str(v),
        _ => {
            use tantivy::columnar::NumericalValue as N;
            let number = match value {
                Value::Uint(v) | Value::Int(v) | Value::Time(v) => v
                    .parse::<N>()
                    .map_err(|_| SearchError::Request("numeric operand".into()))?,
                Value::Float(v) => N::F64(*v),
                _ => unreachable!(),
            };
            // Pinned Tantivy JSON postings canonicalize all integer-like values, including
            // small u64 and integral f64 values, to i64 before writing their type tag.
            match number.normalize() {
                N::I64(v) => term.append_type_and_fast_value(v),
                N::U64(v) => term.append_type_and_fast_value(v),
                N::F64(v) => term.append_type_and_fast_value(v),
            }
        }
    };
    Ok(term)
}
pub(crate) fn predicate(p: &Predicate, m: &Mapping) -> Result<Box<dyn Query>, SearchError> {
    let present = || presence(m, &p.field);
    let equality = |v: &Value| -> Result<Box<dyn Query>, SearchError> {
        if matches!(v,Value::Text(s)|Value::Identifier(s) if s.is_empty()) {
            Ok(not(present()))
        } else {
            equality_term(m, &p.field, v)
        }
    };
    Ok(match p.operation {
        Operation::Missing | Operation::Empty => not(present()),
        Operation::Present => present(),
        Operation::Eq => equality(&p.values[0])?,
        Operation::Ne => {
            let q = not(equality(&p.values[0])?);
            if matches!(p.values[0], Value::Text(_) | Value::Identifier(_)) {
                q
            } else {
                and(vec![present(), q])
            }
        }
        Operation::Any | Operation::All | Operation::None => {
            let qs = p
                .values
                .iter()
                .map(|v| equality_term(m, &p.field, v))
                .collect::<Result<Vec<_>, SearchError>>()?;
            match p.operation {
                Operation::All => and(qs),
                Operation::None => not(or(qs)),
                _ => or(qs),
            }
        }
        op => {
            let t = term(m, &p.field, &p.values[0])?;
            let (lo, hi) = match op {
                Operation::Lt => (Bound::Unbounded, Bound::Excluded(t)),
                Operation::Le => (Bound::Unbounded, Bound::Included(t)),
                Operation::Gt => (Bound::Excluded(t), Bound::Unbounded),
                Operation::Ge => (Bound::Included(t), Bound::Unbounded),
                _ => return Err(SearchError::Request("range".into())),
            };
            and(vec![present(), Box::new(RangeQuery::new(lo, hi))])
        }
    })
}
pub(crate) fn condition_bound(
    c: &Condition,
    m: &Mapping,
    bindings: Option<&crate::reference::Bindings>,
) -> Result<Box<dyn Query>, SearchError> {
    Ok(match c {
        Condition::And(cs) => and(cs
            .iter()
            .map(|c| condition_bound(c, m, bindings))
            .collect::<Result<_, _>>()?),
        Condition::Or(cs) => or(cs
            .iter()
            .map(|c| condition_bound(c, m, bindings))
            .collect::<Result<_, _>>()?),
        Condition::Not(c) => not(condition_bound(c, m, bindings)?),
        Condition::Predicate(p) => predicate(p, m)?,
        Condition::Reference(operand) => crate::reference::query(operand, m, bindings)?,
    })
}
#[cfg(test)]
pub(crate) fn compile(
    index: &Index,
    m: &Mapping,
    catalogue: &Catalogue,
    text: &str,
    filter: Option<&Condition>,
) -> Result<Box<dyn Query>, SearchError> {
    compile_bound(
        index,
        m,
        catalogue,
        text,
        filter,
        &crate::reference::Bindings::new(),
    )
}
pub(crate) fn compile_bound(
    index: &Index,
    m: &Mapping,
    catalogue: &Catalogue,
    text: &str,
    filter: Option<&Condition>,
    bindings: &crate::reference::Bindings,
) -> Result<Box<dyn Query>, SearchError> {
    let native = if text.trim().is_empty() {
        Box::new(ConstScoreQuery::new(Box::new(AllQuery), 0.0)) as Box<dyn Query>
    } else {
        native_bound(index, m, &parse(text)?, Some(bindings))?
    };
    if let Some(c) = filter {
        c.validate(catalogue)?;
        Ok(and(vec![
            native,
            Box::new(BoostQuery::new(condition_bound(c, m, Some(bindings))?, 0.0)),
        ]))
    } else {
        Ok(native)
    }
}
pub(crate) fn parse(text: &str) -> Result<Ast, SearchError> {
    tantivy::query_grammar::parse_query(text).map_err(|e| SearchError::Native(format!("{e:?}")))
}
#[cfg(test)]
pub(crate) fn program(
    index: &Index,
    m: &Mapping,
    p: &Program,
) -> Result<Box<dyn Query>, SearchError> {
    program_bound(index, m, p, Some(&crate::reference::Bindings::new()))
}
pub(crate) fn program_bound(
    index: &Index,
    m: &Mapping,
    p: &Program,
    bindings: Option<&crate::reference::Bindings>,
) -> Result<Box<dyn Query>, SearchError> {
    if p.source.text.trim().is_empty() {
        return Ok(Box::new(AllQuery));
    }
    native_bound(index, m, &parse(&p.source.text)?, bindings)
}
fn native_bound(
    index: &Index,
    m: &Mapping,
    ast: &Ast,
    bindings: Option<&crate::reference::Bindings>,
) -> Result<Box<dyn Query>, SearchError> {
    match ast {
        Ast::Boost(child, boost) => Ok(Box::new(BoostQuery::new(
            native_bound(index, m, child, bindings)?,
            boost.into_inner() as f32,
        ))),
        Ast::Clause(children) => {
            if children.is_empty() {
                return Ok(Box::new(EmptyQuery));
            }
            let mut qs = Vec::new();
            let mut positive = false;
            for (occur, child) in children {
                let occur = match occur {
                    Some(tantivy::query_grammar::Occur::Must) => Occur::Must,
                    Some(tantivy::query_grammar::Occur::MustNot) => Occur::MustNot,
                    _ => Occur::Should,
                };
                positive |= occur != Occur::MustNot;
                qs.push((occur, native_bound(index, m, child, bindings)?));
            }
            if !positive {
                qs.push((
                    Occur::Must,
                    Box::new(ConstScoreQuery::new(Box::new(AllQuery), 0.0)),
                ));
                return Ok(Box::new(ConstScoreQuery::new(
                    Box::new(BooleanQuery::new(qs)),
                    0.0,
                )));
            }
            Ok(Box::new(BooleanQuery::new(qs)))
        }
        Ast::Leaf(leaf) => {
            if let Some(operand) = crate::reference::leaf(leaf, &m.catalogue)? {
                return crate::reference::query(&operand, m, bindings);
            }
            if let Leaf::Exists { field } = &**leaf {
                let d = m
                    .catalogue
                    .fields
                    .iter()
                    .find(|d| d.native_value == *field || d.native_exact == *field)
                    .ok_or_else(|| SearchError::Native(format!("undeclared field {field}")))?;
                return Ok(presence(m, &d.id));
            }
            let public_field = match &**leaf {
                Leaf::Literal(l) => l.field_name.as_deref(),
                Leaf::Range { field, .. } | Leaf::Set { field, .. } | Leaf::Regex { field, .. } => {
                    field.as_deref()
                }
                _ => None,
            };
            if let Some(name) = public_field {
                let d = m
                    .catalogue
                    .fields
                    .iter()
                    .find(|d| d.native_value == name || d.native_exact == name)
                    .ok_or_else(|| SearchError::Native(format!("undeclared field {name}")))?;
                match &**leaf {
                    Leaf::Literal(l)
                        if d.field_type == FieldType::Text
                            && name == d.native_value
                            && l.prefix =>
                    {
                        use tantivy::tokenizer::TokenStream;
                        let mut analyzer = index
                            .tokenizers()
                            .get("locus_hybrid_v1")
                            .ok_or_else(|| SearchError::Invalid("analyzer".into()))?;
                        let mut tokens = Vec::new();
                        analyzer.token_stream(&l.phrase).process(&mut |t| {
                            let mut term = Term::from_field_json_path(m.text, &d.id, false);
                            term.append_type_and_str(&t.text);
                            tokens.push((t.position, term));
                        });
                        if tokens.is_empty() {
                            return Err(SearchError::Native(
                                "Prefix must analyze to at least one term".into(),
                            ));
                        }
                        return Ok(Box::new(
                            tantivy::query::PhrasePrefixQuery::new_with_offset(tokens),
                        ));
                    }
                    Leaf::Regex { pattern, .. }
                        if matches!(d.field_type, FieldType::Text | FieldType::Identifier) =>
                    {
                        let analyzed = d.field_type == FieldType::Text && name == d.native_value;
                        let native = regex_query(m, &d.id, analyzed, pattern)?;
                        return Ok(if analyzed {
                            native
                        } else {
                            Box::new(ConstScoreQuery::new(
                                with_original(
                                    m,
                                    &d.id,
                                    crate::original::Match::Regex(std::sync::Arc::new(
                                        tantivy_fst::Regex::new(pattern)
                                            .map_err(|e| SearchError::Native(e.to_string()))?,
                                    )),
                                    native,
                                ),
                                1.0,
                            ))
                        });
                    }
                    Leaf::Literal(l)
                        if name == d.native_exact
                            && l.prefix
                            && matches!(d.field_type, FieldType::Text | FieldType::Identifier) =>
                    {
                        let native = regex_query(
                            m,
                            &d.id,
                            false,
                            &format!("{}(?s:.*)", regex_escape(&l.phrase)),
                        )?;
                        return Ok(Box::new(ConstScoreQuery::new(
                            with_original(
                                m,
                                &d.id,
                                crate::original::Match::Prefix(l.phrase.clone()),
                                native,
                            ),
                            1.0,
                        )));
                    }
                    Leaf::Regex { .. }
                        if !matches!(d.field_type, FieldType::Text | FieldType::Identifier) =>
                    {
                        return Err(SearchError::Native(
                            "Regex requires a text or identifier field".into(),
                        ));
                    }
                    Leaf::Set { elements, .. } => {
                        let native = Box::new(TermSetQuery::new(
                            elements
                                .iter()
                                .map(|s| boundary_term(index, m, d, name, s))
                                .collect::<Result<Vec<_>, _>>()?,
                        ));
                        return Ok(
                            if name == d.native_exact
                                && matches!(d.field_type, FieldType::Text | FieldType::Identifier)
                            {
                                Box::new(ConstScoreQuery::new(
                                    with_original(
                                        m,
                                        &d.id,
                                        crate::original::Match::Set(elements.clone()),
                                        native,
                                    ),
                                    1.0,
                                ))
                            } else {
                                native
                            },
                        );
                    }
                    Leaf::Range { lower, upper, .. } => {
                        let bound=|b:&tantivy::query_grammar::UserInputBound|->Result<Bound<Term>,SearchError>{use tantivy::query_grammar::UserInputBound as B;Ok(match b{B::Unbounded=>Bound::Unbounded,B::Inclusive(s)=>Bound::Included(boundary_term(index,m,d,name,s)?),B::Exclusive(s)=>Bound::Excluded(boundary_term(index,m,d,name,s)?)})};
                        if matches!(lower, tantivy::query_grammar::UserInputBound::Unbounded)
                            && matches!(upper, tantivy::query_grammar::UserInputBound::Unbounded)
                        {
                            return Err(SearchError::Native(
                                "Unbounded ranges are not presence; use field:*".into(),
                            ));
                        }
                        let native = Box::new(RangeQuery::new(bound(lower)?, bound(upper)?));
                        return Ok(
                            if name == d.native_exact
                                && matches!(d.field_type, FieldType::Text | FieldType::Identifier)
                            {
                                let raw = |b: &tantivy::query_grammar::UserInputBound| match b {
                                    tantivy::query_grammar::UserInputBound::Unbounded => {
                                        Bound::Unbounded
                                    }
                                    tantivy::query_grammar::UserInputBound::Inclusive(s) => {
                                        Bound::Included(s.clone())
                                    }
                                    tantivy::query_grammar::UserInputBound::Exclusive(s) => {
                                        Bound::Excluded(s.clone())
                                    }
                                };
                                Box::new(ConstScoreQuery::new(
                                    with_original(
                                        m,
                                        &d.id,
                                        crate::original::Match::Range(raw(lower), raw(upper)),
                                        native,
                                    ),
                                    1.0,
                                ))
                            } else {
                                native
                            },
                        );
                    }
                    Leaf::Literal(l)
                        if matches!(
                            d.field_type,
                            FieldType::Uint | FieldType::Int | FieldType::Time | FieldType::Float
                        ) =>
                    {
                        return Ok(exact(boundary_term(index, m, d, name, &l.phrase)?));
                    }
                    Leaf::Literal(l) if name == d.native_exact && !l.prefix => {
                        // A declared string remains a string even when its spelling
                        // resembles a JSON number/date/bool. Preserve native BM25.
                        let value = if d.field_type == FieldType::Text {
                            Value::Text(l.phrase.clone())
                        } else {
                            Value::Identifier(l.phrase.clone())
                        };
                        let native = Box::new(TermQuery::new(
                            term(m, &d.id, &value)?,
                            IndexRecordOption::WithFreqs,
                        ));
                        return Ok(if l.phrase.len() > crate::original::MAX_TERM_BYTES {
                            long_equality(m, &d.id, &l.phrase, true)
                        } else {
                            native
                        });
                    }
                    _ => (),
                }
            }
            let mut leaf = leaf.clone();
            let field = match &mut *leaf {
                Leaf::Literal(l) => &mut l.field_name,
                Leaf::Range { field, .. } | Leaf::Set { field, .. } | Leaf::Regex { field, .. } => {
                    field
                }
                _ => {
                    return parser(index, m)
                        .build_query_from_user_input_ast(Ast::Leaf(leaf))
                        .map_err(|e| SearchError::Native(e.to_string()));
                }
            };
            if let Some(name) = field {
                *name = m.reference(name)?;
            }
            let native = parser(index, m)
                .build_query_from_user_input_ast(Ast::Leaf(leaf))
                .map_err(|e| SearchError::Native(e.to_string()))?;
            Ok(native)
        }
    }
}
fn boundary_term(
    index: &Index,
    m: &Mapping,
    d: &locus_query::api::FieldDefinition,
    name: &str,
    lexeme: &str,
) -> Result<Term, SearchError> {
    let value = match d.field_type {
        FieldType::Uint => Value::Uint(
            lexeme
                .parse::<u64>()
                .map_err(|_| SearchError::Native("Expected unsigned integer".into()))?
                .to_string(),
        ),
        FieldType::Int => Value::Int(
            lexeme
                .parse::<i64>()
                .map_err(|_| SearchError::Native("Expected integer".into()))?
                .to_string(),
        ),
        FieldType::Time => Value::Time(
            lexeme
                .parse::<i64>()
                .map_err(|_| SearchError::Native("Expected timestamp integer".into()))?
                .to_string(),
        ),
        FieldType::Float => Value::Float(
            lexeme
                .parse()
                .map_err(|_| SearchError::Native("Expected float".into()))?,
        ),
        FieldType::Identifier => Value::Identifier(lexeme.into()),
        FieldType::Text => Value::Text(lexeme.into()),
    };
    value.validate(d.field_type)?;
    if d.field_type == FieldType::Text && name == d.native_value {
        use tantivy::tokenizer::TokenStream;
        let mut analyzer = index
            .tokenizers()
            .get("locus_hybrid_v1")
            .ok_or_else(|| SearchError::Invalid("analyzer".into()))?;
        let mut stream = analyzer.token_stream(lexeme);
        let mut tokens = Vec::new();
        stream.process(&mut |t| tokens.push(t.text.clone()));
        if tokens.len() != 1 {
            return Err(SearchError::Native(
                "Text set/range boundary must analyze to one token".into(),
            ));
        }
        let mut term = Term::from_field_json_path(m.text, &d.id, false);
        term.append_type_and_str(&tokens[0]);
        Ok(term)
    } else {
        term(m, &d.id, &value)
    }
}
