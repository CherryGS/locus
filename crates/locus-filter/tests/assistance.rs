#![allow(clippy::expect_used, clippy::unwrap_used)]
use locus_filter::api::*;
use locus_query::api::*;
fn catalogue() -> Catalogue {
    Catalogue::new(vec![
        FieldDefinition::new("tag_names", "tag", FieldType::Text, Shape::Collection),
        FieldDefinition::new("count", "test", FieldType::Uint, Shape::Scalar),
        FieldDefinition::new("time", "test", FieldType::Time, Shape::Scalar),
        FieldDefinition::new("duration", "test", FieldType::Float, Shape::Scalar),
    ])
    .unwrap()
}
#[test]
fn owner_literals_preserve_native_reference_originals_and_profile() {
    let catalogue = catalogue();
    let lang = language();
    for reference in ["tag_names", "tag_names_exact"] {
        for value in [
            "",
            "cat girl",
            "one\r\ntwo",
            "\\n",
            "\"quote\"\\backslash",
            "中文é😀\u{0000}",
            "123",
            "true",
        ] {
            let output = literal(
                &catalogue,
                LiteralRequest {
                    format: lang.format.into(),
                    version: lang.version,
                    field: reference.into(),
                    value: Value::Text(value.into()),
                },
            )
            .unwrap();
            assert_eq!(output.reference, reference);
            assert!(output.condition.starts_with(&format!("{reference}:")));
            let parsed = inspect(native_source(&output.condition))
                .unwrap()
                .parsed
                .unwrap();
            let ParsedNode::Literal { text: phrase, .. } = parsed else {
                panic!("expected literal")
            };
            assert_eq!(phrase, value);
        }
    }
    assert!(
        literal(
            &catalogue,
            LiteralRequest {
                format: lang.format.into(),
                version: 1,
                field: "tag_names".into(),
                value: Value::Text("a".into())
            }
        )
        .is_err()
    );
    assert!(
        literal(
            &catalogue,
            LiteralRequest {
                format: lang.format.into(),
                version: 2,
                field: "unknown".into(),
                value: Value::Text("a".into())
            }
        )
        .is_err()
    );
    for (field, value) in [
        ("count", Value::Uint(u64::MAX.to_string())),
        ("time", Value::Time(i64::MIN.to_string())),
        ("duration", Value::Float(0.125)),
    ] {
        let output = literal(
            &catalogue,
            LiteralRequest {
                format: lang.format.into(),
                version: 2,
                field: field.into(),
                value,
            },
        )
        .unwrap();
        assert!(compile(native_source(output.condition)).is_ok());
        let help = field_help(
            &catalogue,
            FieldHelpRequest {
                format: lang.format.into(),
                version: 2,
                field: Some(field.into()),
            },
        )
        .unwrap();
        for example in help.examples {
            assert!(compile(native_source(example)).is_ok());
        }
    }
    let help = field_help(
        &catalogue,
        FieldHelpRequest {
            format: lang.format.into(),
            version: 2,
            field: Some("tag_names".into()),
        },
    )
    .unwrap();
    assert_eq!(help.reference, "tag_names");
    assert!(help.guidance.contains("analyzes"));
    let defaults = field_help(
        &catalogue,
        FieldHelpRequest {
            format: lang.format.into(),
            version: 2,
            field: None,
        },
    )
    .unwrap();
    assert!(defaults.guidance.contains("tag_names"));
    assert!(
        defaults
            .examples
            .iter()
            .all(|example| compile(native_source(example)).is_ok())
    );
}
fn context(text: &str, offset: usize, marker: Option<usize>) -> EditingContext {
    editing_context(
        &catalogue(),
        EditingRequest {
            source: native_source(text),
            offset,
            marker,
        },
    )
    .unwrap()
}
#[test]
fn source_owned_safe_spans_partial_quotes_and_indeterminate_complex_syntax() {
    for text in ["", "  \r\n", "(", "foo AND ", "foo OR ", "NOT "] {
        assert_eq!(
            context(text, text.len(), None).kind,
            EditingKind::ConditionStart,
            "{text}"
        );
    }
    let field = context("+@tag_na", 8, Some(1));
    assert_eq!(field.kind, EditingKind::Field);
    assert_eq!(field.fragment, "tag_na");
    assert_eq!(field.field_range.unwrap().start, 2);
    let text = "中文\r\n@tag_names_exact:\"cat girl\" tail";
    let marker = text.find('@').unwrap();
    let offset = text.find("cat").unwrap() + 3;
    let value = context(text, offset, Some(marker));
    assert_eq!(value.kind, EditingKind::Value);
    assert_eq!(value.fragment, "cat");
    let range = value.value_range.unwrap();
    assert_eq!(&text[range.start..range.end], "\"cat girl\"");
    let field = context(text, marker + 5, Some(marker));
    assert_eq!(
        &text[field.value_range.unwrap().start..field.condition_range.unwrap().end],
        "\"cat girl\""
    );
    for value in [
        "\"partial'",
        "\"^",
        "\"~",
        "INDIGO",
        "\"[",
        "\"cat\\\"",
        "\"cat\\\\",
        "\"star*",
    ] {
        let text = format!("tag_names:{value}");
        assert_eq!(
            context(&text, text.len(), None).kind,
            EditingKind::Value,
            "{text}"
        );
    }
    assert_eq!(
        context("tag_names:\"partial'", 19, None).fragment,
        "partial'"
    );
    for text in [
        "tag_names:/a @",
        "+/a @",
        "-/a @",
        "tag_names:/a\\/ @",
        "tag_names:[a TO @",
        "tag_names:IN [a @",
        "tag_names:(a @",
        "tag_names:(/[)] @inside/)",
    ] {
        let marker = text.rfind('@').unwrap();
        assert_eq!(
            context(text, text.len(), Some(marker)).kind,
            EditingKind::Indeterminate,
            "{text}"
        );
    }
    for text in [
        "tag_names:\"cat\"*",
        "tag_names:\"cat\"~2",
        "tag_names:>=2",
        "unknown:a",
        "@tag_names:\"a\"b",
    ] {
        assert_eq!(
            context(text, text.len(), None).kind,
            EditingKind::Indeterminate,
            "{text}"
        );
    }
    for text in ["\"[\" @tag", "tag_names:/a/ @tag", "(foo OR @tag"] {
        let marker = text.find('@').unwrap();
        assert_eq!(
            context(text, text.len(), Some(marker)).kind,
            EditingKind::Field,
            "{text}"
        );
    }
    assert_eq!(context("@tag", 0, Some(0)).kind, EditingKind::Indeterminate);
    assert_eq!(context("-foo", 0, None).kind, EditingKind::Indeterminate);
    for text in [
        "@count:>=1920",
        "@tag_names_exact:[a TO z]",
        "@tag_names_exact:IN [a b]",
        "@tag_names_exact:/a.*/",
    ] {
        let editing = context(text, text.len(), Some(0));
        assert_eq!(editing.kind, EditingKind::Indeterminate);
        assert!(editing.field.is_some());
        assert!(editing.reference.is_some());
        assert!(editing.value_range.is_none());
        assert!(editing.field_range.is_some());
    }
    let edited = context("@time:>=1920", 5, Some(0));
    assert_eq!(edited.kind, EditingKind::Field);
    assert_eq!(edited.field.as_deref(), Some("time"));
    assert!(
        editing_context(
            &catalogue(),
            EditingRequest {
                source: native_source("😀"),
                offset: 1,
                marker: None
            }
        )
        .is_err()
    );
    assert_eq!(
        context("tag_names:\"@inside\"", 18, None).kind,
        EditingKind::Value
    );
}

#[test]
fn query_reference_help_literal_and_editing_use_identity_without_rewriting_source() {
    use locus_query::api::*;
    let catalogue = Catalogue::with_references(
        vec![FieldDefinition::new(
            "tag_ids",
            "tag",
            FieldType::Identifier,
            Shape::Collection,
        )],
        vec![ReferenceDefinition {
            id: "tag_subtree".into(),
            owner: "tag".into(),
            target_field: "tag_ids".into(),
            meaning: ReferenceMeaning::InclusiveSubtree,
        }],
    )
    .unwrap();
    let source = locus_filter::api::native_source("tag_subtree:");
    let identity = "01992853C12370008000000000000001";
    let literal = locus_filter::api::literal(
        &catalogue,
        locus_filter::api::LiteralRequest {
            format: source.format.clone(),
            version: source.version,
            field: "tag_subtree".into(),
            value: Value::Identifier(identity.into()),
        },
    )
    .unwrap();
    assert_eq!(literal.condition, format!("tag_subtree:\"{identity}\""));
    assert!(
        locus_filter::api::compile(locus_filter::api::native_source(&literal.condition)).is_ok()
    );
    let help = locus_filter::api::field_help(
        &catalogue,
        locus_filter::api::FieldHelpRequest {
            format: source.format.clone(),
            version: source.version,
            field: Some("tag_subtree".into()),
        },
    )
    .unwrap();
    assert!(help.guidance.contains("zero relevance"));
    let context = locus_filter::api::editing_context(
        &catalogue,
        locus_filter::api::EditingRequest {
            offset: source.text.len(),
            source,
            marker: None,
        },
    )
    .unwrap();
    assert_eq!(context.field.as_deref(), Some("tag_subtree"));
    assert!(context.value_range.is_some());
}
