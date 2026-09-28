#![allow(clippy::expect_used, clippy::unwrap_used)]
use locus_filter::api::{ParsedNode, compile, inspect, native_source};
#[test]
fn strict_profile_source_fidelity_and_reserved_calls() {
    let raw = "  中文\r\ncount:00018446744073709551615\n";
    assert_eq!(compile(native_source(raw)).unwrap().source.text, raw);
    for text in ["", " \r\n"] {
        assert!(inspect(native_source(text)).unwrap().parsed.is_none());
        let mut old = native_source(text);
        old.version = 1;
        assert!(compile(old).is_err());
    }
    for text in [
        "@sql(\"SELECT 1\")",
        "@name(\"x\", foo)",
        "field:(@other(foo))",
        "+@name(foo)",
        "field:@sql(foo)",
        "@helper (x)",
    ] {
        assert!(
            compile(native_source(text))
                .unwrap_err()
                .message
                .contains("Unsupported"),
            "{text}"
        );
    }
    for text in [
        "\"@sql(abc)\"",
        "'@name(abc)'",
        r"/@sql\(abc\)/",
        r"\@sql\(abc\)",
        "foo@sql(\"x\")",
        "path/@name(\"x\")",
    ] {
        if tantivy_query_grammar::parse_query(text).is_ok() {
            assert!(compile(native_source(text)).is_ok(), "{text}");
        }
    }
    for text in ["foo AND", "\"unfinished", "foo)", "("] {
        assert!(inspect(native_source(text)).is_err(), "{text}");
    }
    assert!(matches!(
        inspect(native_source("*")).unwrap().parsed,
        Some(ParsedNode::All)
    ));
}
#[test]
fn observation_preserves_occurrences_and_native_leaf_meaning() {
    let observe =
        |text| serde_json::to_value(inspect(native_source(text)).unwrap().parsed.unwrap()).unwrap();
    let group = observe("+alpha beta -gamma");
    assert_eq!(group["clauses"][0]["occurrence"], "required");
    assert_eq!(group["clauses"][1]["occurrence"], "default");
    assert_eq!(group["clauses"][2]["occurrence"], "excluded");
    assert_eq!(observe("alpha beta")["clauses"][0]["occurrence"], "default");
    assert_eq!(
        observe("alpha OR beta")["clauses"][0]["occurrence"],
        "optional"
    );
    assert_eq!(
        observe("alpha AND beta")["clauses"][0]["occurrence"],
        "required"
    );
    let nested = observe("(alpha OR beta) AND NOT gamma");
    assert_eq!(nested["kind"], "group");
    assert!(nested.to_string().contains("excluded"));
    assert_eq!(observe("foo^2")["value"], 2.0);
    let phrase = observe("title:\"one two\"~3");
    assert_eq!(phrase["field"], "title");
    assert_eq!(phrase["slop"], 3);
    assert_eq!(phrase["delimiter"], "double_quotes");
    assert_eq!(observe("title:\"one tw\"*")["prefix"], true);
    let range = observe("count:[00018446744073709551615 TO 18446744073709551615}");
    assert_eq!(range["lower"]["kind"], "inclusive");
    assert_eq!(range["upper"]["kind"], "exclusive");
    assert_eq!(range["lower"]["value"], "00018446744073709551615");
    assert_eq!(
        observe("count:IN [18446744073709551615]")["elements"][0],
        "18446744073709551615"
    );
    assert_eq!(observe("title:*")["kind"], "presence");
    assert_eq!(observe("title:/ab.*/")["pattern"], "ab.*");
    assert_eq!(observe("unknown_field:foo")["field"], "unknown_field");
}
