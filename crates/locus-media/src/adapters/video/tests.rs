use super::{
    identify::{Family, classify},
    metadata::parse,
};
use crate::error::FailureCode;

#[test]
fn first_temporal_stream_keeps_unknown_properties() {
    let facts = parse(br#"{"streams":[{"index":0,"codec_type":"video","disposition":{"attached_pic":1}},{"index":2,"codec_type":"video","width":0,"height":0,"duration":"N/A"},{"index":3,"codec_type":"video","width":1920,"height":1080,"duration":"42"}],"format":{"duration":"90"}}"#,Family::Mov).unwrap();
    assert_eq!(facts.stream_index, 2);
    assert_eq!(facts.width, None);
    assert_eq!(facts.duration, None);
}
#[test]
fn duration_is_stream_scoped_and_validated() {
    let facts = parse(
        br#"{"streams":[{"index":1,"codec_type":"video","duration_ts":120,"time_base":"1/30"}]}"#,
        Family::Matroska,
    )
    .unwrap();
    assert_eq!(facts.duration.unwrap().seconds, 4.0);
    for bad in ["NaN", "-1", "inf", "999999999999"] {
        let bytes =
            format!(r#"{{"streams":[{{"index":0,"codec_type":"video","duration":"{bad}"}}]}}"#);
        assert!(parse(bytes.as_bytes(), Family::Mov).is_err());
    }
}
#[test]
fn classifier_rejects_image_and_unknown_brands() {
    for brand in [b"avif", b"heic", b"mif1", b"xxxx"] {
        let mut bytes = vec![0, 0, 0, 20];
        bytes.extend_from_slice(b"ftypisom\0\0\0\0");
        bytes.extend_from_slice(brand);
        assert!(classify(&bytes).is_err());
    }
    assert_eq!(
        classify(b"\0\0\0\x14ftypisom\0\0\0\0mp42").unwrap(),
        Family::Mov
    );
    assert!(classify(b"GIF89a").is_err());
    assert_eq!(
        classify(b"\x1a\x45\xdf\xa3\x87\x42\x82\x84webm").unwrap(),
        Family::Matroska
    );
    assert_eq!(
        classify(b"\x1a\x45\xdf\xa3\x01\0\0\0\0\0\0\x07\x42\x82\x84webm").unwrap(),
        Family::Matroska
    );
    assert!(classify(b"\x1a\x45\xdf\xa3\x01\0\0\0\0\0\0\xff").is_err());
}

#[test]
fn temporal_png_codec_is_not_still_image_evidence() {
    let facts=parse(br#"{"streams":[{"index":0,"codec_type":"video","codec_name":"png"},{"index":1,"codec_type":"video","codec_name":"h264"}]}"#,Family::Mov).unwrap();
    assert_eq!(facts.stream_index, 0);
    assert_eq!(facts.codec.as_deref(), Some("png"));
}

#[test]
fn artwork_and_still_dispositions_never_establish_temporal_video() {
    for flag in ["attached_pic", "timed_thumbnails", "still_image"] {
        let json = format!(
            r#"{{"streams":[{{"index":0,"codec_type":"video","disposition":{{"{flag}":1}}}},{{"index":1,"codec_type":"audio"}}]}}"#
        );
        assert_eq!(
            parse(json.as_bytes(), Family::Mov).unwrap_err().code,
            FailureCode::UnsupportedInput
        );
    }
    for json in [
        br#"{"streams":{}}"#.as_slice(),
        br#"{"streams":[{"index":0,"codec_type":"video","width":-1}]}"#,
        br#"{"streams":[{"index":0,"codec_type":"video","duration_ts":2,"time_base":"1/0"}]}"#,
    ] {
        assert_eq!(
            parse(json, Family::Mov).unwrap_err().code,
            FailureCode::MalformedOutput
        );
    }
}

#[test]
fn recognition_budget_and_required_probe_output_are_failures() {
    let mut bytes = vec![0; 64 * 1024];
    bytes[..4].copy_from_slice(&100_000_u32.to_be_bytes());
    bytes[4..8].copy_from_slice(b"ftyp");
    assert_eq!(classify(&bytes).unwrap_err().code, FailureCode::Limit);
    bytes[..12].copy_from_slice(b"\x1a\x45\xdf\xa3\x01\0\0\0\0\x01\x86\xa0");
    assert_eq!(classify(&bytes).unwrap_err().code, FailureCode::Limit);
    for json in [
        br#"{"streams":[{"index":0}]}"#.as_slice(),
        br#"{"streams":[{"codec_type":4}]}"#,
    ] {
        assert_eq!(
            parse(json, Family::Mov).unwrap_err().code,
            FailureCode::MalformedOutput
        );
    }
}
