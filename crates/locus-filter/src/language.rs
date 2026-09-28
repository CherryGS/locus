use locus_query::api::Source;
pub const FORMAT: &str = "locus-native-tantivy-0.26";
pub const VERSION: u32 = 2;
pub fn native_source(text: impl Into<String>) -> Source {
    Source {
        format: FORMAT.into(),
        version: VERSION,
        text: text.into(),
    }
}
pub struct Language {
    pub format: &'static str,
    pub version: u32,
    pub offset_encoding: &'static str,
    pub syntax: &'static [&'static str],
}
pub fn language() -> Language {
    Language {
        format: FORMAT,
        version: VERSION,
        offset_encoding: "utf-8-bytes",
        syntax: &[
            "Default OR; + required, - excluded, optional clauses add relevance",
            "AND OR NOT; NOT is full zero-scoring complement",
            "field:* means logical nonempty; presence scores one",
        ],
    }
}
