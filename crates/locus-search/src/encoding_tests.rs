#![allow(clippy::expect_used, clippy::unwrap_used)]
use crate::{collector::Complete, compiler, schema::Mapping};
use locus_core::api::{ComponentId, EntityId};
use locus_query::api::*;
use tantivy::Index;
fn pred(field: &str, operation: Operation, values: Vec<Value>) -> Condition {
    Condition::Predicate(Predicate {
        field: field.into(),
        operation,
        values,
    })
}
#[test]
fn engine_state_precision_identifier_and_neutral_filter_matrix() {
    let catalogue = Catalogue::new(vec![
        FieldDefinition::new("title", "test", FieldType::Text, Shape::Scalar),
        FieldDefinition::new("opaque", "test", FieldType::Identifier, Shape::Scalar),
        FieldDefinition::new("count", "test", FieldType::Uint, Shape::Scalar),
        FieldDefinition::new("time", "test", FieldType::Time, Shape::Scalar),
        FieldDefinition::new("tags", "test", FieldType::Text, Shape::Collection),
    ])
    .unwrap();
    let mapping = Mapping::new(&catalogue).unwrap();
    let index = Index::create_in_ram(mapping.schema.clone());
    mapping.configure(&index);
    let mut writer = index.writer_with_num_threads(1, 15_000_000).unwrap();
    let ids = [
        EntityId::new(),
        EntityId::new(),
        EntityId::new(),
        EntityId::new(),
    ];
    let component = ComponentId::new();
    for (i, id) in ids.iter().enumerate() {
        let title = match i {
            0 | 1 => Some(Value::Text("alpha".into())),
            2 => Some(Value::Text("".into())),
            _ => None,
        };
        let count = match i {
            0 | 1 => Some(Value::Uint("0".into())),
            2 => Some(Value::Uint(u64::MAX.to_string())),
            _ => None,
        };
        let time = match i {
            0 => Some(Value::Time(i64::MIN.to_string())),
            1 => Some(Value::Time(i64::MAX.to_string())),
            2 => Some(Value::Time("0".into())),
            _ => None,
        };
        let tags = match i {
            0 => Some(vec![]),
            1 => Some(vec![Value::Text("".into())]),
            2 => Some(vec![Value::Text("red".into())]),
            _ => None,
        };
        let values = vec![
            FieldValue::scalar("title", component, title),
            FieldValue::scalar("count", component, count),
            FieldValue::scalar("time", component, time),
            FieldValue::collection("tags", component, tags),
            FieldValue::scalar(
                "opaque",
                component,
                if i == 0 {
                    Some(Value::Identifier("A:B/C_1".into()))
                } else {
                    None
                },
            ),
        ];
        writer
            .add_document(mapping.document(*id, &values).unwrap())
            .unwrap();
    }
    writer.commit().unwrap();
    writer.wait_merging_threads().unwrap();
    let reader = index.reader().unwrap();
    let searcher = reader.searcher();
    let run = |text: &str, filter: Option<Condition>| {
        let q = compiler::compile(&index, &mapping, &catalogue, text, filter.as_ref()).unwrap();
        let mut hits = searcher
            .search(
                &*q,
                &Complete {
                    scoring: !text.is_empty(),
                },
            )
            .unwrap();
        hits.sort_unstable_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
        hits
    };
    let found = |text: &str, filter| {
        run(text, filter)
            .into_iter()
            .map(|(_, bytes)| EntityId::from_bytes(&bytes).unwrap())
            .collect::<Vec<_>>()
    };
    assert_eq!(
        found("", Some(pred("title", Operation::Empty, vec![]))),
        vec![ids[2], ids[3]]
    );
    assert_eq!(
        found(
            "",
            Some(pred("title", Operation::Eq, vec![Value::Text("".into())]))
        ),
        vec![ids[2], ids[3]]
    );
    assert_eq!(
        found("", Some(pred("title", Operation::Missing, vec![]))),
        vec![ids[2], ids[3]]
    );
    assert_eq!(
        found(
            "",
            Some(pred("count", Operation::Eq, vec![Value::Uint("0".into())]))
        ),
        vec![ids[0], ids[1]]
    );
    assert_eq!(
        found(
            "",
            Some(pred(
                "count",
                Operation::Ge,
                vec![Value::Uint(u64::MAX.to_string())]
            ))
        ),
        vec![ids[2]]
    );
    assert_eq!(
        found(
            "",
            Some(pred(
                "time",
                Operation::Eq,
                vec![Value::Time(i64::MIN.to_string())]
            ))
        ),
        vec![ids[0]]
    );
    assert_eq!(
        found(
            "",
            Some(pred(
                "time",
                Operation::Ge,
                vec![Value::Time(i64::MAX.to_string())]
            ))
        ),
        vec![ids[1]]
    );
    assert_eq!(found("opaque:\"A:B/C_1\"", None), vec![ids[0]]);
    assert!(
        found(
            "",
            Some(pred(
                "opaque",
                Operation::Eq,
                vec![Value::Identifier("a:b/c_1".into())]
            ))
        )
        .is_empty()
    );
    assert_eq!(found("title:*", None), vec![ids[0], ids[1]]);
    assert_eq!(found("NOT title:*", None), vec![ids[2], ids[3]]);
    assert_eq!(
        found("", Some(pred("tags", Operation::Empty, vec![]))),
        vec![ids[0], ids[3]]
    );
    assert_eq!(
        found(
            "",
            Some(pred("tags", Operation::Any, vec![Value::Text("".into())]))
        ),
        vec![ids[1]]
    );
    assert_eq!(
        found(
            "",
            Some(pred("tags", Operation::None, vec![Value::Text("".into())]))
        ),
        vec![ids[0], ids[2], ids[3]]
    );
    let nested = Condition::And(vec![
        Condition::Or(vec![
            pred("title", Operation::Empty, vec![]),
            pred("count", Operation::Eq, vec![Value::Uint("0".into())]),
        ]),
        Condition::Not(Box::new(pred(
            "time",
            Operation::Eq,
            vec![Value::Time(i64::MIN.to_string())],
        ))),
    ]);
    assert_eq!(found("", Some(nested)), vec![ids[1], ids[2], ids[3]]);
    let typed = compiler::compile(
        &index,
        &mapping,
        &catalogue,
        "",
        Some(&pred("count", Operation::Present, vec![])),
    )
    .unwrap();
    assert!(
        searcher
            .search(&*typed, &Complete { scoring: true })
            .unwrap()
            .iter()
            .all(|(score, _)| *score == 0.0)
    );
    let scores = run("alpha", None);
    assert_eq!(scores.len(), 2);
    assert_eq!(scores[0].0, scores[1].0);
    assert_eq!(scores[0].1, *ids[0].as_bytes());
    assert_eq!(
        scores,
        run("alpha", Some(pred("count", Operation::Present, vec![])))
    );
}
