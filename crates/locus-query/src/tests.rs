use crate::{condition::*, definition::*, projection::*};
#[test]
fn rejects_contradictory_definitions_and_values() {
    let mut field = FieldDefinition::new("width", "image", FieldType::Uint, Shape::Scalar);
    field.operations.push(Operation::Empty);
    assert!(Catalogue::new(vec![field]).is_err());
    let field = FieldDefinition::new("title", "source", FieldType::Text, Shape::Scalar);
    assert!(
        FieldValue {
            field: "title".into(),
            component: None,
            value: ValueState::Values(vec![Value::Text("".into())])
        }
        .validate(&field)
        .is_err()
    );
    assert!(
        Value::Uint("18446744073709551615".into())
            .validate(FieldType::Uint)
            .is_ok()
    );
    assert!(
        Value::Uint("18446744073709551616".into())
            .validate(FieldType::Uint)
            .is_err()
    );
    assert!(
        Value::Time("-9223372036854775808".into())
            .validate(FieldType::Time)
            .is_ok()
    );
}
#[test]
fn owner_assistance_metadata_rejects_incompatible_types() {
    for (kind, capability) in [
        (FieldType::Text, Assistance::Bounds),
        (FieldType::Time, Assistance::Strings),
    ] {
        let mut field = FieldDefinition::new("field", "owner", kind, Shape::Scalar);
        field.assistance = capability;
        assert!(Catalogue::new(vec![field]).is_err());
    }
    let mut field = FieldDefinition::new("field", "owner", FieldType::Uint, Shape::Scalar);
    field.choices = Some(DeclaredChoices {
        closed: true,
        values: vec!["Png".into()],
    });
    assert!(Catalogue::new(vec![field]).is_err());
}

#[test]
fn query_only_references_reject_collisions_and_incompatible_targets() {
    use crate::api::*;
    let field = FieldDefinition::new("ids", "owner", FieldType::Identifier, Shape::Collection);
    let reference = ReferenceDefinition {
        id: "branch".into(),
        owner: "owner".into(),
        target_field: "ids".into(),
        meaning: ReferenceMeaning::InclusiveSubtree,
    };
    let catalogue =
        Catalogue::with_references(vec![field.clone()], vec![reference.clone()]).unwrap();
    let identity = "01992853C12370008000000000000001";
    let operand = ReferenceOperand {
        reference: "branch".into(),
        identity: identity.into(),
    };
    operand.validate(&catalogue).unwrap();
    assert_eq!(
        operand.normalized().unwrap().identity,
        "01992853-c123-7000-8000-000000000001"
    );
    assert!(
        Catalogue::with_references(
            vec![field.clone()],
            vec![ReferenceDefinition {
                id: "ids".into(),
                ..reference.clone()
            }]
        )
        .is_err()
    );
    assert!(
        Catalogue::with_references(
            vec![field.clone()],
            vec![reference.clone(), reference.clone()]
        )
        .is_err()
    );
    assert!(
        Catalogue::with_references(
            vec![field.clone()],
            vec![ReferenceDefinition {
                owner: "foreign".into(),
                ..reference.clone()
            }]
        )
        .is_err()
    );
    assert!(
        Catalogue::with_references(
            vec![FieldDefinition::new(
                "ids",
                "owner",
                FieldType::Text,
                Shape::Collection
            )],
            vec![reference]
        )
        .is_err()
    );
    assert!(
        Condition::Predicate(Predicate {
            field: "branch".into(),
            operation: Operation::Any,
            values: vec![Value::Identifier(identity.into())]
        })
        .validate(&catalogue)
        .is_err()
    );
    assert!(
        ReferenceOperand {
            reference: "branch".into(),
            identity: "wrong".into()
        }
        .validate(&catalogue)
        .is_err()
    );
    assert!(
        ReferenceOperand {
            reference: "absent".into(),
            identity: identity.into()
        }
        .validate(&catalogue)
        .is_err()
    );
}
