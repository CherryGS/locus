use crate::observation::ParsedNode;
use locus_query::api::{Diagnostic, Program, Source, SourceRange};

pub struct Inspection {
    pub program: Program,
    pub parsed: Option<ParsedNode>,
}
pub fn compile(source: Source) -> Result<Program, Diagnostic> {
    inspect(source).map(|i| i.program)
}
pub fn inspect(source: Source) -> Result<Inspection, Diagnostic> {
    let error = |start, end, message: String| Diagnostic {
        range: SourceRange { start, end },
        message,
    };
    if source.format != crate::language::FORMAT || source.version != crate::language::VERSION {
        return Err(error(
            0,
            source.text.len(),
            "Unsupported source format/version".into(),
        ));
    }
    reject_calls(&source.text)?;
    let parsed = if source.text.trim().is_empty() {
        None
    } else {
        Some(
            tantivy_query_grammar::parse_query(&source.text)
                .map_err(|e| error(0, source.text.len(), format!("Native syntax: {e:?}")))?
                .into(),
        )
    };
    Ok(Inspection {
        program: Program { source },
        parsed,
    })
}

// Only reserve the former operand-call namespace. Quoted strings, native regex
// bodies, escaped characters and @ suffixes inside ordinary words stay native.
fn reject_calls(text: &str) -> Result<(), Diagnostic> {
    let mut pos = 0;
    while pos < text.len() {
        let ch = text[pos..].chars().next().unwrap_or_default();
        if ch == '\\' {
            pos += 1;
            pos += text[pos..].chars().next().map_or(0, char::len_utf8);
            continue;
        }
        if matches!(ch, '\'' | '"') {
            pos += 1;
            while pos < text.len() {
                let next = text[pos..].chars().next().unwrap_or_default();
                pos += next.len_utf8();
                if next == '\\' {
                    pos += text[pos..].chars().next().map_or(0, char::len_utf8);
                } else if next == ch {
                    break;
                }
            }
            continue;
        }
        let boundary = |prefix: &str| {
            prefix
                .chars()
                .last()
                .is_none_or(|c| c.is_whitespace() || matches!(c, '(' | ':'))
        };
        let prefix = &text[..pos];
        let operand = boundary(prefix) || prefix.strip_suffix(['+', '-']).is_some_and(boundary);
        if ch == '/' && operand {
            let mut end = pos + 1;
            while end < text.len() {
                if text[end..].starts_with("\\/") {
                    end += 2;
                    continue;
                }
                if text[end..].starts_with('/') {
                    let after = end + 1;
                    if after > pos + 2
                        && text[after..]
                            .chars()
                            .next()
                            .is_none_or(|c| c.is_whitespace() || c == ')')
                    {
                        pos = after;
                    }
                    break;
                }
                end += text[end..].chars().next().map_or(1, char::len_utf8);
            }
            if pos > prefix.len() {
                continue;
            }
        }
        if ch == '@' && operand {
            let end = text[pos + 1..]
                .find(|c: char| !c.is_ascii_alphanumeric() && c != '_')
                .map_or(text.len(), |n| pos + 1 + n);
            if end > pos + 1 && text[end..].trim_start().starts_with('(') {
                return Err(Diagnostic {
                    range: SourceRange { start: pos, end },
                    message: "Unsupported reserved call; use native query syntax".into(),
                });
            }
        }
        pos += ch.len_utf8();
    }
    Ok(())
}
