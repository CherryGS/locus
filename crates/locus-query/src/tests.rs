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
