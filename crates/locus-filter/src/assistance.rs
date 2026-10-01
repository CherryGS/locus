use locus_query::api::{Catalogue, Diagnostic, FieldType, Source, SourceRange, Value};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct LiteralRequest {
    pub format: String,
    pub version: u32,
    pub field: String,
    pub value: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Literal {
    pub reference: String,
    pub literal: String,
    pub condition: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct FieldHelpRequest {
    pub format: String,
    pub version: u32,
    /// None requests native unfielded/default-source guidance.
    pub field: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct FieldHelp {
    pub reference: String,
    pub examples: Vec<String>,
    pub guidance: String,
    pub offset_encoding: String,
}
fn diagnostic(message: impl Into<String>) -> Diagnostic {
    Diagnostic {
        range: SourceRange { start: 0, end: 0 },
        message: message.into(),
    }
}
pub(crate) fn profile(format: &str, version: u32) -> Result<(), Diagnostic> {
    if format != crate::language::FORMAT || version != crate::language::VERSION {
        return Err(diagnostic("Unsupported source format/version"));
    }
    Ok(())
}
/// Native escaping has no JSON control-character escapes: a real LF stays LF,
/// while backslash+n stays backslash+n after native decoding.
pub(crate) fn quote(value: &str) -> String {
    let mut literal = String::with_capacity(value.len() + 2);
    literal.push('"');
    for c in value.chars() {
        if matches!(c, '"' | '\\') {
            literal.push('\\');
        }
        literal.push(c);
    }
    literal.push('"');
    literal
}
pub fn literal(catalogue: &Catalogue, request: LiteralRequest) -> Result<Literal, Diagnostic> {
    profile(&request.format, request.version)?;
    let field = catalogue
        .fields
        .iter()
        .find(|f| f.native_value == request.field || f.native_exact == request.field)
        .ok_or_else(|| diagnostic("Unknown native field reference"))?;
    request
        .value
        .validate(field.field_type)
        .map_err(|e| diagnostic(e.to_string()))?;
    let literal = match request.value {
        Value::Text(s) | Value::Identifier(s) => quote(&s),
        Value::Uint(s) | Value::Int(s) | Value::Time(s) => s,
        Value::Float(v) => v.to_string(),
    };
    Ok(Literal {
        reference: request.field.clone(),
        condition: format!("{}:{literal}", request.field),
        literal,
    })
}
pub fn field_help(
    catalogue: &Catalogue,
    request: FieldHelpRequest,
) -> Result<FieldHelp, Diagnostic> {
    profile(&request.format, request.version)?;
    let Some(reference) = request.field else {
        let defaults = catalogue
            .fields
            .iter()
            .filter(|f| f.default_text)
            .map(|f| f.native_value.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        return Ok(FieldHelp {
            reference: String::new(),
            examples: vec![
                "cat girl".into(),
                "\"cat girl\"".into(),
                "+cat -girl".into(),
                "(cat OR girl) AND NOT dog".into(),
            ],
            guidance: format!(
                "Native unfielded source uses default OR; quoted input forms a phrase. Default text fields: {defaults}. Occurrence prefixes + and - require or exclude clauses. Use explicit catalogue references for typed field conditions."
            ),
            offset_encoding: "utf-8-bytes".into(),
        });
    };
    let field = catalogue
        .fields
        .iter()
        .find(|f| f.native_value == reference || f.native_exact == reference)
        .ok_or_else(|| diagnostic("Unknown native field reference"))?;
    let (examples, guidance) = match field.field_type {
        FieldType::Identifier | FieldType::Text => (
            vec![
                format!("{reference}:\"cat girl\""),
                format!("{reference}:\"quote\\\" and backslash\\\\\""),
                format!("{reference}:*"),
            ],
            "Accepted original values use the exact reference and native quoted literals. Manual values are native source; unquoted whitespace starts another clause. Escape backslash and quote only; retain actual newline/control characters.",
        ),
        FieldType::Uint => (
            vec![
                format!("{reference}:1920"),
                format!("{reference}:>=1920"),
                format!("{reference}:[1920 TO 3840]"),
            ],
            "Unsigned decimal integers; observed bounds guide writing and do not constrain valid values.",
        ),
        FieldType::Int => (
            vec![
                format!("{reference}:-1"),
                format!("{reference}:>=0"),
                format!("{reference}:[-10 TO 10]"),
            ],
            "Signed decimal integers; preserve full integer precision.",
        ),
        FieldType::Time => (
            vec![
                format!("{reference}:1700000000000"),
                format!("{reference}:>=1700000000000"),
                format!("{reference}:[1700000000000 TO 1800000000000]"),
            ],
            "Signed Unix milliseconds; native date literals are not supported for this field.",
        ),
        FieldType::Float => (
            vec![
                format!("{reference}:0.125"),
                format!("{reference}:>=0.125"),
                format!("{reference}:[0.125 TO 2.5]"),
            ],
            "Finite numeric values in the declared unit; observed bounds do not constrain valid values.",
        ),
    };
    let guidance = if field.field_type == FieldType::Text && reference == field.native_value {
        "This text reference analyzes native words and quoted phrases. Candidate acceptance serializes the original data while preserving this reference. Manual values are native source; unquoted whitespace starts another clause. Use the catalogue exact reference to match a complete original. Escape backslash and quote only; retain actual newline/control characters."
    } else {
        guidance
    };
    Ok(FieldHelp {
        reference,
        examples,
        guidance: guidance.into(),
        offset_encoding: "utf-8-bytes".into(),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct EditingRequest {
    pub source: Source,
    pub offset: usize,
    /// Consumer-owned helper marker. This does not assert a fresh input event.
    pub marker: Option<usize>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EditingKind {
    ConditionStart,
    Field,
    Value,
    Indeterminate,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct EditingContext {
    pub kind: EditingKind,
    pub field: Option<String>,
    pub reference: Option<String>,
    pub field_range: Option<SourceRange>,
    /// Existing colon separator, separate from the editable reference span.
    pub separator_range: Option<SourceRange>,
    pub value_range: Option<SourceRange>,
    pub condition_range: Option<SourceRange>,
    pub fragment: String,
    pub offset_encoding: String,
}
impl EditingContext {
    pub(crate) fn empty(kind: EditingKind) -> Self {
        Self {
            kind,
            field: None,
            reference: None,
            field_range: None,
            separator_range: None,
            value_range: None,
            condition_range: None,
            fragment: String::new(),
            offset_encoding: "utf-8-bytes".into(),
        }
    }
}
