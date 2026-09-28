use serde::{Deserialize, Serialize};

/// Original source is retained verbatim. Offsets in source observations are UTF-8
/// byte offsets; browser adapters convert them to the editor's UTF-16 positions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Source {
    pub format: String,
    pub version: u32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
pub struct SourceRange {
    pub start: usize,
    pub end: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Diagnostic {
    pub range: SourceRange,
    pub message: String,
}

/// Native source input; Filter checks supported syntax, while Search validates
/// fields and readiness against the selected native engine.
#[derive(Debug, Clone)]
pub struct Program {
    pub source: Source,
}
