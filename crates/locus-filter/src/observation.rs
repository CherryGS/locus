use serde::{Deserialize, Serialize};
use tantivy_query_grammar::{
    Delimiter, Occur, UserInputAst as Ast, UserInputBound as Bound, UserInputLeaf as Leaf,
};

/// Native grammar observation, not a source map or a separately editable query.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ParsedNode {
    Group {
        clauses: Vec<ParsedClause>,
    },
    Boost {
        value: f64,
        child: Box<ParsedNode>,
    },
    Literal {
        field: Option<String>,
        text: String,
        delimiter: String,
        slop: u32,
        prefix: bool,
    },
    Range {
        field: Option<String>,
        lower: ParsedBound,
        upper: ParsedBound,
    },
    Set {
        field: Option<String>,
        elements: Vec<String>,
    },
    Presence {
        field: String,
    },
    All,
    Regex {
        field: Option<String>,
        pattern: String,
    },
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct ParsedClause {
    /// None in the native grammar is kept distinct from explicit OR.
    pub occurrence: String,
    pub node: ParsedNode,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum ParsedBound {
    Inclusive(String),
    Exclusive(String),
    Unbounded,
}
impl From<Bound> for ParsedBound {
    fn from(b: Bound) -> Self {
        match b {
            Bound::Inclusive(s) => Self::Inclusive(s),
            Bound::Exclusive(s) => Self::Exclusive(s),
            Bound::Unbounded => Self::Unbounded,
        }
    }
}
impl From<Ast> for ParsedNode {
    fn from(ast: Ast) -> Self {
        match ast {
            Ast::Clause(cs) => Self::Group {
                clauses: cs
                    .into_iter()
                    .map(|(o, n)| ParsedClause {
                        occurrence: match o {
                            None => "default",
                            Some(Occur::Must) => "required",
                            Some(Occur::Should) => "optional",
                            Some(Occur::MustNot) => "excluded",
                        }
                        .into(),
                        node: n.into(),
                    })
                    .collect(),
            },
            Ast::Boost(n, b) => Self::Boost {
                value: b.into_inner(),
                child: Box::new((*n).into()),
            },
            Ast::Leaf(l) => match *l {
                Leaf::Literal(l) => Self::Literal {
                    field: l.field_name,
                    text: l.phrase,
                    delimiter: match l.delimiter {
                        Delimiter::None => "none",
                        Delimiter::SingleQuotes => "single_quotes",
                        Delimiter::DoubleQuotes => "double_quotes",
                    }
                    .into(),
                    slop: l.slop,
                    prefix: l.prefix,
                },
                Leaf::Range {
                    field,
                    lower,
                    upper,
                } => Self::Range {
                    field,
                    lower: lower.into(),
                    upper: upper.into(),
                },
                Leaf::Set { field, elements } => Self::Set { field, elements },
                Leaf::Exists { field } => Self::Presence { field },
                Leaf::All => Self::All,
                Leaf::Regex { field, pattern } => Self::Regex { field, pattern },
            },
        }
    }
}
