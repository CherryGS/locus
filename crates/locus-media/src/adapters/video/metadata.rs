use super::{
    command::{self, input_args},
    identify::{Family, family},
};
use crate::{
    adapters::process,
    error::{AttemptFailure, FailureCode},
    facts::{DurationPrecision, StreamDuration, VideoFacts},
    service::MediaService,
};
use locus_file::api::LocalFile;
use serde_json::Value;

fn malformed(detail: impl ToString) -> AttemptFailure {
    AttemptFailure::new(FailureCode::MalformedOutput, detail)
}

pub(crate) async fn inspect(
    storage: &MediaService,
    input: LocalFile,
) -> Result<VideoFacts, AttemptFailure> {
    let family = family(storage, &input).await?;
    let mut args = input_args(storage, family);
    args.extend(command::args(&["-show_streams", "-of", "json"]));
    args.push(input.path().as_os_str().to_owned());
    let bytes = process::run(storage, &storage.config.ffprobe, args, 1024 * 1024).await?;
    parse(&bytes, family)
}
fn optional_text(value: Option<&Value>) -> Result<Option<String>, AttemptFailure> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(v)) if v == "N/A" || v == "unknown" => Ok(None),
        Some(Value::String(v)) if !v.is_empty() && v.len() <= 128 => Ok(Some(v.clone())),
        _ => Err(malformed("invalid stream text")),
    }
}
fn dimension(value: Option<&Value>) -> Result<Option<u32>, AttemptFailure> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(v) => {
            let n = v
                .as_u64()
                .and_then(|v| u32::try_from(v).ok())
                .ok_or_else(|| malformed("invalid dimension"))?;
            Ok((n > 0).then_some(n))
        }
    }
}
fn number(value: &Value) -> Result<Option<f64>, AttemptFailure> {
    if value.is_null() || value.as_str() == Some("N/A") {
        return Ok(None);
    }
    let number = match value {
        Value::String(v) => v.parse::<f64>().map_err(malformed)?,
        Value::Number(v) => v.as_f64().ok_or_else(|| malformed("invalid number"))?,
        _ => return Err(malformed("invalid number")),
    };
    if !number.is_finite() || number < 0.0 {
        return Err(malformed("negative/nonfinite number"));
    }
    Ok(Some(number))
}
pub(crate) fn parse(bytes: &[u8], family: Family) -> Result<VideoFacts, AttemptFailure> {
    let root: Value = serde_json::from_slice(bytes).map_err(malformed)?;
    let streams = root
        .get("streams")
        .and_then(Value::as_array)
        .ok_or_else(|| malformed("streams array missing"))?;
    for stream in streams {
        let object = stream
            .as_object()
            .ok_or_else(|| malformed("stream object"))?;
        if object.get("codec_type").and_then(Value::as_str) != Some("video") {
            continue;
        }
        let mut excluded = false;
        if let Some(disposition) = object.get("disposition") {
            let disposition = disposition
                .as_object()
                .ok_or_else(|| malformed("disposition object"))?;
            for name in ["attached_pic", "timed_thumbnails", "still_image"] {
                if let Some(value) = disposition.get(name) {
                    match value.as_u64() {
                        Some(0) => (),
                        Some(1) => excluded = true,
                        _ => return Err(malformed("invalid disposition")),
                    }
                }
            }
        }
        if excluded {
            continue;
        }
        let codec = optional_text(object.get("codec_name"))?;
        let stream_index = object
            .get("index")
            .and_then(Value::as_u64)
            .and_then(|v| u32::try_from(v).ok())
            .ok_or_else(|| malformed("stream index"))?;
        let mut duration = object.get("duration").map(number).transpose()?.flatten();
        if duration.is_none() {
            let ticks = object.get("duration_ts").map(number).transpose()?.flatten();
            if let (Some(ticks), Some(base)) = (ticks, object.get("time_base")) {
                let (numerator, denominator) = base
                    .as_str()
                    .and_then(|v| v.split_once('/'))
                    .ok_or_else(|| malformed("time_base"))?;
                let numerator = numerator.parse::<u64>().map_err(malformed)?;
                let denominator = denominator.parse::<u64>().map_err(malformed)?;
                if numerator == 0 || denominator == 0 || ticks.fract() != 0.0 {
                    return Err(malformed("invalid duration ticks/time base"));
                }
                duration = Some(ticks * numerator as f64 / denominator as f64);
            }
        }
        if duration.is_some_and(|v| !v.is_finite() || v > 315_576_000.0) {
            return Err(malformed("duration out of range"));
        }
        return Ok(VideoFacts {
            container: family.name().into(),
            stream_index,
            codec,
            width: dimension(object.get("width"))?,
            height: dimension(object.get("height"))?,
            duration: duration.map(|seconds| StreamDuration {
                seconds,
                precision: DurationPrecision::Unknown,
            }),
        });
    }
    Err(AttemptFailure::new(
        FailureCode::UnsupportedInput,
        "no eligible temporal video stream",
    ))
}
