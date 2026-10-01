//! Deliberately bounded lexical support, not a permissive semantic parser. Only
//! simple field/value regions are editable; ranges, sets, regex and field groups
//! return indeterminate. All coordinates address the untouched UTF-8 source.
use crate::assistance::{EditingContext, EditingKind, EditingRequest, profile};
use locus_query::api::{Catalogue, Diagnostic, SourceRange};

#[derive(Clone)]
struct Token {
    start: usize,
    end: usize,
    complex: bool,
}
fn tokens(text: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < text.len() {
        let c = text[i..].chars().next().unwrap_or_default();
        if c.is_whitespace() {
            i += c.len_utf8();
            continue;
        }
        if matches!(c, '(' | ')') {
            tokens.push(Token {
                start: i,
                end: i + 1,
                complex: false,
            });
            i += 1;
            continue;
        }
        let start = i;
        let mut quote = None;
        let mut escaped = false;
        let mut complex = false;
        let mut bracket: Option<(char, usize)> = None;
        while i < text.len() {
            let c = text[i..].chars().next().unwrap_or_default();
            if escaped {
                escaped = false;
                i += c.len_utf8();
                continue;
            }
            if c == '\\' {
                escaped = true;
                i += 1;
                continue;
            }
            if let Some(q) = quote {
                if c == q {
                    quote = None;
                    if q != '/'
                        && text[i + c.len_utf8()..]
                            .chars()
                            .next()
                            .is_some_and(|next| !next.is_whitespace() && !matches!(next, '(' | ')'))
                    {
                        complex = true;
                    }
                }
                i += c.len_utf8();
                continue;
            }
            if matches!(c, '"' | '\'') {
                quote = Some(c);
                i += 1;
                continue;
            }
            if let Some((closing, depth)) = bracket {
                // Parentheses in regex bodies/character classes cannot close an
                // enclosing field group and expose a false condition start.
                if c == '/' {
                    quote = Some('/');
                    i += 1;
                    continue;
                }
                let opening = match closing {
                    ']' => '[',
                    '}' => '{',
                    _ => '(',
                };
                if c == opening {
                    bracket = Some((closing, depth + 1));
                }
                if c == closing {
                    bracket = if depth == 1 {
                        None
                    } else {
                        Some((closing, depth - 1))
                    };
                }
                i += c.len_utf8();
                continue;
            }
            let before = text[start..i].trim_end();
            if matches!(c, '[' | '{') || c == '(' && before.ends_with(':') {
                complex = true;
                bracket = Some((
                    match c {
                        '[' => ']',
                        '{' => '}',
                        _ => ')',
                    },
                    1,
                ));
                i += 1;
                continue;
            }
            if c == '/' && (before.ends_with(':') || i == start || matches!(before, "+" | "-")) {
                complex = true;
                quote = Some('/');
                i += 1;
                continue;
            }
            if matches!(c, '^' | '~') {
                complex = true;
            }
            if c.is_whitespace() {
                let pending_set = before
                    .split_once(':')
                    .is_some_and(|(_, value)| value.trim() == "IN");
                let pending_comparison = before
                    .split_once(':')
                    .is_some_and(|(_, value)| matches!(value.trim(), "<" | ">" | "<=" | ">="));
                if before.ends_with(':') || pending_set || pending_comparison {
                    complex |= pending_set || pending_comparison;
                    i += c.len_utf8();
                    continue;
                }
                break;
            }
            if matches!(c, '(' | ')') {
                break;
            }
            i += c.len_utf8();
        }
        tokens.push(Token {
            start,
            end: i,
            complex,
        });
    }
    tokens
}
fn decode(text: &str) -> String {
    let mut chars = text.chars();
    let quote = chars.clone().next().filter(|c| matches!(c, '"' | '\''));
    if quote.is_some() {
        chars.next();
    }
    let mut value = String::new();
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(c) = chars.next() {
                value.push(c);
            }
        } else if !(Some(c) == quote && chars.as_str().is_empty()) {
            value.push(c);
        }
    }
    value
}
pub fn editing_context(
    catalogue: &Catalogue,
    request: EditingRequest,
) -> Result<EditingContext, Diagnostic> {
    profile(&request.source.format, request.source.version)?;
    let text = &request.source.text;
    let fail = |message: &str| Diagnostic {
        range: SourceRange {
            start: 0,
            end: text.len(),
        },
        message: message.into(),
    };
    if !text.is_char_boundary(request.offset) || request.offset > text.len() {
        return Err(fail("Offset must be a UTF-8 byte boundary"));
    }
    if let Some(marker) = request.marker
        && (marker >= text.len()
            || !text.is_char_boundary(marker)
            || !text[marker..].starts_with('@'))
    {
        return Err(fail("Invalid tracked helper marker"));
    }
    let tokens = tokens(text);
    let active = tokens
        .iter()
        .enumerate()
        .find(|(_, t)| t.start <= request.offset && request.offset <= t.end);
    let Some((_index, token)) = active else {
        // Incomplete range/set/field-group prefixes make whitespace unsafe.
        if tokens.last().is_some_and(|t| t.complex) {
            return Ok(EditingContext::empty(EditingKind::Indeterminate));
        }
        return Ok(EditingContext::empty(EditingKind::ConditionStart));
    };
    let raw = &text[token.start..token.end];
    if matches!(raw, "(" | "AND" | "OR" | "NOT" | "+" | "-") {
        return Ok(EditingContext::empty(EditingKind::ConditionStart));
    }
    if raw == ")" {
        return Ok(EditingContext::empty(EditingKind::Indeterminate));
    }
    let mut start = token.start;
    if text[start..].starts_with(['+', '-']) {
        start += 1;
    }
    if let Some(marker) = request.marker {
        if marker != start {
            return Ok(EditingContext::empty(EditingKind::Indeterminate));
        }
        start += 1;
    }
    if request.offset < start {
        return Ok(EditingContext::empty(EditingKind::Indeterminate));
    }
    let colon = text[start..token.end].find(':').map(|p| start + p);
    let field_end = colon.unwrap_or(token.end);
    if !text[start..field_end]
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return Ok(EditingContext::empty(EditingKind::Indeterminate));
    }
    let reference = &text[start..field_end];
    let field = catalogue
        .fields
        .iter()
        .find(|f| f.native_value == reference || f.native_exact == reference);
    let mut result = EditingContext::empty(EditingKind::Field);
    result.field = field.map(|f| f.id.clone());
    result.reference = Some(reference.into());
    result.field_range = Some(SourceRange {
        start,
        end: field_end,
    });
    result.separator_range = colon.map(|start| SourceRange {
        start,
        end: start + 1,
    });
    result.condition_range = Some(SourceRange {
        start: token.start,
        end: token.end,
    });
    if token.complex {
        // The header remains attributable/editable while complex value syntax
        // stays manual. Never retain a previous field's help or supply an unsafe
        // candidate replacement span for a range, set, regex, or mixed literal.
        result.kind = if request.offset <= field_end {
            EditingKind::Field
        } else {
            EditingKind::Indeterminate
        };
        result.fragment = if request.offset >= start && request.offset <= field_end {
            text[start..request.offset].into()
        } else {
            String::new()
        };
        return Ok(result);
    }
    if request.offset <= field_end || colon.is_none() {
        result.fragment = text[start..request.offset.min(field_end)].into();
        if let Some(colon) = colon {
            let value_start = colon + 1 + text[colon + 1..token.end].len()
                - text[colon + 1..token.end].trim_start().len();
            result.value_range = Some(SourceRange {
                start: value_start,
                end: token.end,
            });
        }
        return Ok(result);
    }
    let Some(colon) = colon else {
        return Ok(result);
    };
    let value_start = colon + 1 + text[colon + 1..token.end].len()
        - text[colon + 1..token.end].trim_start().len();
    let value = &text[value_start..token.end];
    if field.is_none()
        || value.starts_with(['[', '{', '/', '<', '>', '*', '('])
        || value == "IN"
        || (!value.starts_with(['\"', '\'']) && value.ends_with('*'))
    {
        result.kind = EditingKind::Indeterminate;
        return Ok(result);
    }
    if request.offset < value_start {
        result.kind = EditingKind::Value;
        result.value_range = Some(SourceRange {
            start: value_start,
            end: token.end,
        });
        return Ok(result);
    }
    result.kind = EditingKind::Value;
    result.value_range = Some(SourceRange {
        start: value_start,
        end: token.end,
    });
    result.fragment = decode(&text[value_start..request.offset]);
    Ok(result)
}
