#![allow(clippy::expect_used, clippy::unwrap_used)]
use crate::{
    collector::Complete,
    compiler,
    discovery::{DiscoveryContext, Observed, StringMatching, StringPageRequest},
    schema::Mapping,
};
use locus_core::api::{ComponentId, EntityId};
use locus_query::api::*;
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
use tantivy::{Index, Term};
fn field(id: &str, kind: FieldType, shape: Shape) -> FieldDefinition {
    let mut f = FieldDefinition::new(id, "fixture", kind, shape);
    f.assistance = if matches!(kind, FieldType::Text | FieldType::Identifier) {
        Assistance::Strings
    } else {
        Assistance::Bounds
    };
    f
}
fn fixture() -> (Mapping, Index, Vec<EntityId>) {
    let catalogue = Catalogue::new(vec![
        field("title", FieldType::Text, Shape::Scalar),
        field("tags", FieldType::Text, Shape::Collection),
        field("uint", FieldType::Uint, Shape::Scalar),
        field("int", FieldType::Int, Shape::Scalar),
        field("time", FieldType::Time, Shape::Scalar),
        field("float", FieldType::Float, Shape::Scalar),
        field("absent", FieldType::Uint, Shape::Scalar),
    ])
    .unwrap();
    let mapping = Mapping::new(&catalogue).unwrap();
    let index = Index::create_in_ram(mapping.schema.clone());
    mapping.configure(&index);
    (mapping, index, (0..5).map(|_| EntityId::new()).collect())
}
fn context(index: &Index) -> DiscoveryContext {
    let reader = index.reader().unwrap();
    DiscoveryContext {
        searcher: reader.searcher(),
        _publication: crate::service::test_publication(index.clone(), reader),
        expires: Instant::now() + Duration::from_secs(600),
        fields: Mutex::new(HashMap::new()),
        cursors: Mutex::new(HashMap::new()),
    }
}
fn page(
    context: &DiscoveryContext,
    m: &Mapping,
    field: &str,
    fragment: &str,
    continuation: Option<String>,
    limit: usize,
) -> crate::discovery::StringPage {
    context
        .strings(
            m,
            StringPageRequest {
                context: "fixture".into(),
                field: field.into(),
                fragment: fragment.into(),
                matching: Default::default(),
                continuation,
                limit: Some(limit),
            },
        )
        .unwrap()
}
#[test]
fn original_discovery_folding_live_precision_paging_and_snapshot() {
    let (m, index, ids) = fixture();
    let c = ComponentId::new();
    let a = format!("{}éA", "x".repeat(65534));
    let b = format!("{}éB", "x".repeat(65534));
    let mut writer = index.writer_with_num_threads(1, 15_000_000).unwrap();
    for (i, id) in ids.iter().enumerate() {
        let tags = match i {
            0 => vec!["", "Straße", "STRASSE", "é", "e\u{301}", "İ", "Σ", "ς"],
            1 => vec!["Straße"],
            2 => vec!["deleted"],
            _ => vec![],
        };
        writer
            .add_document(
                m.document(
                    *id,
                    &[
                        FieldValue::scalar(
                            "title",
                            c,
                            Some(Value::Text(if i == 0 {
                                a.clone()
                            } else if i == 1 {
                                b.clone()
                            } else {
                                String::new()
                            })),
                        ),
                        FieldValue::collection(
                            "tags",
                            c,
                            Some(tags.iter().map(|s| Value::Text((*s).into())).collect()),
                        ),
                        FieldValue::scalar(
                            "uint",
                            c,
                            Some(Value::Uint(
                                ["0", "18446744073709551615", "9007199254740993", "1", "2"][i]
                                    .into(),
                            )),
                        ),
                        FieldValue::scalar(
                            "int",
                            c,
                            Some(Value::Int([i64::MIN, i64::MAX, 0, 1, -1][i].to_string())),
                        ),
                        FieldValue::scalar(
                            "time",
                            c,
                            Some(Value::Time([i64::MIN, i64::MAX, 0, 1, -1][i].to_string())),
                        ),
                        FieldValue::scalar(
                            "float",
                            c,
                            Some(Value::Float([-f64::MAX, f64::MAX, 0.0, 0.125, -0.25][i])),
                        ),
                    ],
                )
                .unwrap(),
            )
            .unwrap();
    }
    writer.commit().unwrap();
    writer.delete_term(Term::from_field_text(m.id, &ids[2].to_string()));
    writer.commit().unwrap();
    let context = context(&index);
    assert_eq!(
        page(&context, &m, "title", "", None, 128).values,
        vec![a.clone(), b.clone()]
    );
    assert_eq!(
        page(&context, &m, "tags", "STRASSE", None, 128).values,
        vec!["STRASSE", "Straße"]
    );
    assert_eq!(
        page(&context, &m, "tags", "σ", None, 128).values,
        vec!["Σ", "ς"]
    );
    assert_eq!(page(&context, &m, "tags", "é", None, 128).values, vec!["é"]);
    let mut first = page(&context, &m, "tags", "", None, 2);
    assert_eq!(first.values[0], "");
    let foreign = first.continuation.clone().unwrap();
    assert!(
        context
            .strings(
                &m,
                StringPageRequest {
                    context: "fixture".into(),
                    field: "title".into(),
                    fragment: String::new(),
                    matching: Default::default(),
                    continuation: Some(foreign),
                    limit: None
                }
            )
            .is_err()
    );
    let mut values = first.values;
    while let Some(token) = first.continuation {
        first = page(&context, &m, "tags", "", Some(token), 2);
        values.extend(first.values.clone());
    }
    assert_eq!(values.len(), 8);
    assert!(!values.contains(&"deleted".into()));
    assert_eq!(
        context.bounds(&m, "uint").unwrap().maximum,
        Some(Value::Uint(u64::MAX.to_string()))
    );
    assert_eq!(
        context.bounds(&m, "int").unwrap().minimum,
        Some(Value::Int(i64::MIN.to_string()))
    );
    assert_eq!(
        context.bounds(&m, "time").unwrap().maximum,
        Some(Value::Time(i64::MAX.to_string()))
    );
    assert_eq!(
        context.bounds(&m, "float").unwrap().minimum,
        Some(Value::Float(-f64::MAX))
    );
    assert!(context.bounds(&m, "absent").unwrap().minimum.is_none());
    writer.delete_term(Term::from_field_text(m.id, &ids[0].to_string()));
    writer.commit().unwrap();
    assert_eq!(
        page(&context, &m, "title", "", None, 128).values,
        vec![a, b.clone()]
    );
    let refreshed = context_new(&index);
    assert_eq!(page(&refreshed, &m, "title", "", None, 128).values, vec![b]);
    assert!(
        page(&refreshed, &m, "tags", "nothing", None, 128)
            .values
            .is_empty()
    );
}

#[test]
fn regex_discovery_preserves_patterns_originals_and_mode_qualified_paging() {
    let (m, index, ids) = fixture();
    let c = ComponentId::new();
    let mut writer = index.writer_with_num_threads(1, 15_000_000).unwrap();
    let originals = [
        "cat", "Cat", "dog", "123", "dot.a", "dotXa", "Σ", "ς", "Straße", "STRASSE", "^$", "",
    ];
    writer
        .add_document(
            m.document(
                ids[0],
                &[FieldValue::collection(
                    "tags",
                    c,
                    Some(originals.iter().map(|s| Value::Text((*s).into())).collect()),
                )],
            )
            .unwrap(),
        )
        .unwrap();
    writer.commit().unwrap();
    let context = context(&index);
    let request = |pattern: &str| StringPageRequest {
        context: "fixture".into(),
        field: "tags".into(),
        fragment: pattern.into(),
        matching: StringMatching::Regex,
        continuation: None,
        limit: Some(128),
    };
    assert_eq!(
        context.strings(&m, request("^(cat|dog)$")).unwrap().values,
        vec!["Cat", "cat", "dog"]
    );
    assert_eq!(
        context.strings(&m, request(r"dot\.a")).unwrap().values,
        vec!["dot.a"]
    );
    assert!(
        !context
            .strings(&m, request(r"^\D+$"))
            .unwrap()
            .values
            .contains(&"123".into())
    );
    assert_eq!(
        context.strings(&m, request("σ")).unwrap().values,
        vec!["Σ", "ς"]
    );
    assert_eq!(
        context.strings(&m, request("^strasse$")).unwrap().values,
        vec!["STRASSE"]
    );
    assert_eq!(context.strings(&m, request("^$")).unwrap().values, vec![""]);
    assert_eq!(
        context.strings(&m, request("")).unwrap().values.len(),
        originals.len()
    );
    assert!(context.strings(&m, request("[")).is_err());
    assert!(context.strings(&m, request("(?=cat)")).is_err());
    let mut first_request = request(".");
    first_request.limit = Some(2);
    let first = context.strings(&m, first_request).unwrap();
    let mut next = request(".");
    next.continuation = first.continuation.clone();
    next.matching = StringMatching::Substring;
    assert!(context.strings(&m, next).is_err());
    let mut values = first.values;
    let mut continuation = first.continuation;
    while continuation.is_some() {
        let mut next = request(".");
        next.continuation = continuation;
        next.limit = Some(2);
        let page = context.strings(&m, next).unwrap();
        values.extend(page.values);
        continuation = page.continuation;
    }
    assert_eq!(values.len(), originals.len() - 1);
    assert_eq!(
        values
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        values.len()
    );
    let legacy: StringPageRequest = serde_json::from_value(serde_json::json!({
        "context": "fixture", "field": "tags", "fragment": ".", "continuation": null, "limit": 128,
    }))
    .unwrap();
    assert_eq!(legacy.matching, StringMatching::Substring);
    assert_eq!(context.strings(&m, legacy).unwrap().values, vec!["dot.a"]);
}
fn context_new(index: &Index) -> DiscoveryContext {
    context(index)
}
#[test]
fn oversized_execution_native_scoring_clauses_and_corruption() {
    let (m, index, ids) = fixture();
    let c = ComponentId::new();
    let a = format!("{}éA", "x".repeat(65534));
    let b = format!("{}éB", "x".repeat(65534));
    let mut writer = index.writer_with_num_threads(1, 15_000_000).unwrap();
    for (i, tags) in [
        vec![a.clone()],
        vec![a.clone(), a.clone()],
        vec![b.clone()],
        vec!["xshort".into(), a.clone()],
        vec!["123".into()],
    ]
    .into_iter()
    .enumerate()
    {
        writer
            .add_document(
                m.document(
                    ids[i],
                    &[
                        FieldValue::collection(
                            "tags",
                            c,
                            Some(tags.into_iter().map(Value::Text).collect()),
                        ),
                        FieldValue::scalar(
                            "title",
                            c,
                            Some(Value::Text(if i == 0 {
                                "bonus".into()
                            } else {
                                "ordinary".into()
                            })),
                        ),
                    ],
                )
                .unwrap(),
            )
            .unwrap();
    }
    writer.commit().unwrap();
    let reader = index.reader().unwrap();
    let searcher = reader.searcher();
    let run = |source: &str| {
        let q = compiler::compile(&index, &m, &m.catalogue, source, None).unwrap();
        searcher.search(&*q, &Complete { scoring: true }).unwrap()
    };
    let source = format!("tags_exact:\"{a}\"");
    let hits = run(&source);
    assert_eq!(hits.len(), 3);
    let score = |hits: &Vec<(f32, [u8; 16])>, i: usize| {
        hits.iter()
            .find(|(_, id)| id == ids[i].as_bytes())
            .unwrap()
            .0
    };
    assert!(score(&hits, 1) > score(&hits, 0));
    let boosted = run(&format!("({source})^2"));
    assert!((score(&boosted, 0) - score(&hits, 0) * 2.0).abs() < 0.0001);
    let optional = run(&format!("+{source} title:bonus"));
    assert!(score(&optional, 0) > score(&hits, 0));
    assert_eq!(run(&format!("tags_exact:IN [\"{a}\" \"xshort\"]")).len(), 3);
    assert_eq!(run("tags_exact:/x.*/").len(), 4);
    for (s, _) in run("tags_exact:/x.*/") {
        assert_eq!(s, 1.0);
    }
    assert_eq!(run("tags_exact:[x TO z]").len(), 4);
    assert_eq!(run("tags_exact:\"x\"*").len(), 4);
    // Lexicographic fallback must also handle long boundaries, whose fast
    // dictionary/posting encodings would otherwise shorten them.
    assert_eq!(run(&format!("tags_exact:[{b} TO z]")).len(), 1);
    for (s, _) in run("tags_exact:[x TO z]") {
        assert_eq!(s, 1.0);
    }
    assert_eq!(run("tags_exact:\"123\"").len(), 1);
    assert_eq!(run("title:\"ord\"*").len(), 4);
    assert_eq!(run("title:/ord.*/").len(), 4);
    let typed = Condition::Predicate(Predicate {
        field: "tags".into(),
        operation: Operation::Any,
        values: vec![Value::Text(a)],
    });
    let q = compiler::compile(&index, &m, &m.catalogue, "", Some(&typed)).unwrap();
    assert_eq!(
        searcher
            .search(&*q, &Complete { scoring: false })
            .unwrap()
            .len(),
        3
    );
    let mut corrupt = tantivy::TantivyDocument::default();
    corrupt.add_object(
        m.values,
        [(
            "tags".into(),
            tantivy::schema::OwnedValue::Str("bad shape".into()),
        )]
        .into_iter()
        .collect(),
    );
    assert!(crate::original::values(&corrupt, m.values, "tags").is_err());
}
#[test]
fn engine_boundary_lookup_collision_verification_preserves_all_originals() {
    let (m, index, ids) = fixture();
    let c = ComponentId::new();
    let values = [
        "x".repeat(65_526),
        "x".repeat(65_527),
        format!("{}é", "x".repeat(65_534)),
    ];
    let mut writer = index.writer_with_num_threads(1, 15_000_000).unwrap();
    for (i, value) in values.iter().enumerate() {
        let mut doc = m
            .document(
                ids[i],
                &[FieldValue::collection(
                    "tags",
                    c,
                    Some(vec![Value::Text(value.clone())]),
                )],
            )
            .unwrap();
        if i == 2 {
            // Simulate a digest collision/poisoned bounded posting. Lookup alone
            // must never certify that this different stored original equals #1.
            doc.add_object(
                m.lookup,
                [(
                    "tags".into(),
                    tantivy::schema::OwnedValue::Array(vec![tantivy::schema::OwnedValue::Str(
                        crate::original::lookup(&values[1]),
                    )]),
                )]
                .into_iter()
                .collect(),
            );
        }
        writer.add_document(doc).unwrap();
    }
    writer.commit().unwrap();
    let reader = index.reader().unwrap();
    let searcher = reader.searcher();
    for (i, value) in values.iter().enumerate() {
        let query = compiler::compile(
            &index,
            &m,
            &m.catalogue,
            &format!("tags_exact:\"{value}\""),
            None,
        )
        .unwrap();
        let hits = searcher
            .search(&*query, &Complete { scoring: true })
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(&hits[0].1, ids[i].as_bytes());
    }
    assert_eq!(
        page(&context(&index), &m, "tags", "", None, 128).values,
        values.to_vec()
    );
}
#[test]
fn exact_range_ignores_truncated_fast_alias_and_keeps_short_collection_members() {
    let (m, index, ids) = fixture();
    let c = ComponentId::new();
    let upper = "x".repeat(65_535);
    let greater = format!("{upper}z");
    let mut writer = index.writer_with_num_threads(1, 15_000_000).unwrap();
    for (i, values) in [
        vec![greater.clone()],
        vec!["a".into(), greater],
        vec![upper.clone()],
        vec!["line\nbreak".into()],
    ]
    .into_iter()
    .enumerate()
    {
        writer
            .add_document(
                m.document(
                    ids[i],
                    &[FieldValue::collection(
                        "tags",
                        c,
                        Some(values.into_iter().map(Value::Text).collect()),
                    )],
                )
                .unwrap(),
            )
            .unwrap();
    }
    writer.commit().unwrap();
    let reader = index.reader().unwrap();
    let searcher = reader.searcher();
    let query = compiler::compile(
        &index,
        &m,
        &m.catalogue,
        &format!("tags_exact:<= {upper}"),
        None,
    )
    .unwrap();
    let hits = searcher
        .search(&*query, &Complete { scoring: true })
        .unwrap();
    assert_eq!(hits.len(), 3);
    assert!(!hits.iter().any(|(_, id)| id == ids[0].as_bytes()));
    assert!(hits.iter().all(|(score, _)| *score == 1.0));
    let query = compiler::compile(&index, &m, &m.catalogue, "tags_exact:\"line\"*", None).unwrap();
    assert_eq!(
        searcher
            .search(&*query, &Complete { scoring: true })
            .unwrap()
            .len(),
        1
    );
}
#[test]
fn many_value_observation_cost_fixture_20000() {
    let (m, index, _) = fixture();
    let c = ComponentId::new();
    let mut writer = index.writer_with_num_threads(1, 15_000_000).unwrap();
    for i in 0..20_000 {
        writer
            .add_document(
                m.document(
                    EntityId::new(),
                    &[FieldValue::scalar(
                        "title",
                        c,
                        Some(Value::Text(format!("Fixture original title {i:08} Straße"))),
                    )],
                )
                .unwrap(),
            )
            .unwrap();
    }
    writer.commit().unwrap();
    let context = context(&index);
    let start = Instant::now();
    let first = page(&context, &m, "title", "", None, 128);
    let elapsed = start.elapsed();
    assert_eq!(first.values.len(), 128);
    let fields = context.fields.lock().unwrap();
    let Observed::Strings(values) = &**fields.get("title").unwrap() else {
        panic!()
    };
    assert_eq!(values.len(), 20_000);
    let allocated = values.capacity() * std::mem::size_of::<(String, String)>()
        + values
            .iter()
            .map(|(folded, raw)| folded.capacity() + raw.capacity())
            .sum::<usize>();
    drop(fields);
    let start = Instant::now();
    let reused = page(&context, &m, "title", "1999", None, 128);
    let reuse_elapsed = start.elapsed();
    assert!(!reused.values.is_empty());
    let mut traversal = first;
    let mut reached = traversal.values.len();
    while let Some(token) = traversal.continuation {
        traversal = page(&context, &m, "title", "", Some(token), 128);
        reached += traversal.values.len();
    }
    assert_eq!(reached, 20_000);
    std::fs::write(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/discovery-fixture.txt"),format!("20000 live Entity/title originals; first={elapsed:?}; reuse={reuse_elapsed:?}; retained field vector/string capacity={allocated} bytes")).unwrap();
    eprintln!(
        "DISCOVERY FIXTURE: 20000 live Entity/title originals; first={elapsed:?}; reuse={reuse_elapsed:?}; retained field vector/string capacity={allocated} bytes"
    );
}
