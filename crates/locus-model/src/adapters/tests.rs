use super::{inspect, recognize};
use std::io::{self, Read};
fn bytes(header: &[u8]) -> Vec<u8> {
    let mut b = (header.len() as u64).to_le_bytes().to_vec();
    b.extend(header);
    b
}
fn parse(
    header: &str,
    body: u64,
) -> Result<crate::record::Inspection, crate::error::AttemptFailure> {
    let b = bytes(header.as_bytes());
    inspect(&mut b.as_slice(), b.len() as u64 + body)
}
#[test]
fn header_only_scalar_empty_mixed_and_subbyte() {
    let f=parse(r#"{"x":{"dtype":"F32","shape":[],"data_offsets":[0,4]},"empty":{"dtype":"I64","shape":[0,5],"data_offsets":[4,4]},"packed":{"dtype":"F4","shape":[2],"data_offsets":[4,5]},"six":{"dtype":"F6_E3M2","shape":[4],"data_offsets":[5,8]}}"#,8).unwrap();
    assert_eq!(f.element_count, 7);
    assert_eq!(f.tensor_count, 4);
    assert_eq!(f.storage_types.len(), 4);
    assert!(f.declarations.is_none());
    assert_eq!(
        parse(r#"{"__metadata__":{}}"#, 0)
            .unwrap()
            .declarations
            .unwrap()
            .len(),
        0
    );
}
#[test]
fn strict_invalid_headers() {
    for h in [
        r#"{"__metadata__":null}"#,
        r#"{"__metadata__":{"a":1}}"#,
        r#"{"__metadata__":{"a":"one","a":"two"}}"#,
        r#"{"x":{"dtype":"F32","dtype":"F16","shape":[],"data_offsets":[0,4]}}"#,
        r#"{"x":{"dtype":"F32","shape":[],"data_offsets":[0,4]},"x":{"dtype":"F32","shape":[],"data_offsets":[0,4]}}"#,
        r#"{"x":{"dtype":"F32","shape":[]}}"#,
        r#"{"x":{"dtype":"ALIEN","shape":[],"data_offsets":[0,4]}}"#,
        r#"{"x":{"dtype":"F32","shape":[18446744073709551615,2],"data_offsets":[0,4]}}"#,
        r#"{"x":{"dtype":"F4","shape":[1],"data_offsets":[0,1]}}"#,
        r#"{"x":{"dtype":"F32","shape":[],"data_offsets":[1,5]}}"#,
        r#"{"x":{"dtype":"F32","shape":[],"data_offsets":[0,4]},"y":{"dtype":"F32","shape":[],"data_offsets":[3,7]}}"#,
        r#"{"x":{"dtype":"F32","shape":[],"data_offsets":[0,4],"unknown":1}}"#,
        "{",
        "[]",
    ] {
        assert!(parse(h, 4).is_err(), "{h}")
    }
    let b = bytes(b"{\xff}");
    assert!(inspect(&mut b.as_slice(), b.len() as u64).is_err());
    let h = r#"{"x":{"dtype":"F32","shape":[],"data_offsets":[0,4]}}"#;
    assert!(parse(h, 3).is_err());
    assert!(parse(h, 5).is_err());
    let mut b = bytes(h.as_bytes());
    b.pop();
    assert!(inspect(&mut b.as_slice(), b.len() as u64).is_err());
}
#[test]
fn recognition_is_bounded_and_failures_are_not_negatives() {
    assert!(!recognize(&mut &b""[..], 0).unwrap());
    assert!(!recognize(&mut &b"ordinary bytes"[..], 14).unwrap());
    let b = bytes(b"{bad");
    assert!(recognize(&mut b.as_slice(), b.len() as u64).unwrap());
    assert!(inspect(&mut b.as_slice(), b.len() as u64).is_err());
    assert!(recognize(&mut &b""[..], 9).is_err());
    struct Broken;
    impl Read for Broken {
        fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
            Err(io::ErrorKind::PermissionDenied.into())
        }
    }
    assert!(recognize(&mut Broken, 9).is_err());
}
#[test]
fn large_descriptor_fixture_and_exact_integer_no_body_read() {
    let mut entries = serde_json::Map::new();
    for n in 0..10_000 {
        entries.insert(
            format!("tensor_{n:05}"),
            serde_json::json!({"dtype":"F16","shape":[0,64],"data_offsets":[0,0]}),
        );
    }
    entries.insert("__metadata__".into(),serde_json::json!({"declared_name":"Synthetic large descriptor fixture","notes":"x".repeat(200_000)}));
    let h = serde_json::to_vec(&entries).unwrap();
    let b = bytes(&h);
    let f = inspect(&mut b.as_slice(), b.len() as u64).unwrap();
    assert_eq!(f.tensor_count, 10_000);
    eprintln!(
        "large fixture: {} header bytes, {} tensors",
        h.len(),
        f.tensor_count
    );
    // A fake extent, no body available to the reader: would fail if body were read.
    let f = parse(
        r#"{"huge":{"dtype":"U8","shape":[9007199254740993],"data_offsets":[0,9007199254740993]}}"#,
        9_007_199_254_740_993,
    )
    .unwrap();
    assert_eq!(f.element_count, 9_007_199_254_740_993);
}
