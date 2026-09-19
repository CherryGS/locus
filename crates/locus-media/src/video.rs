use crate::{
    AttemptFailure, DurationPrecision, FailureCode, MediaStorage, StreamDuration, VideoFacts,
    process,
};
use locus_file::LocalFile;
use serde_json::Value;
use std::{
    ffi::OsString,
    io::{Read, Seek},
};

fn malformed(detail: impl ToString) -> AttemptFailure {
    AttemptFailure::new(FailureCode::MalformedOutput, detail)
}
fn unsupported() -> AttemptFailure {
    AttemptFailure::new(
        FailureCode::UnsupportedInput,
        "expected an allowed movie BMFF brand set or WebM/Matroska EBML header",
    )
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Family {
    Mov,
    Matroska,
}
impl Family {
    fn name(self) -> &'static str {
        match self {
            Self::Mov => "mov",
            Self::Matroska => "matroska",
        }
    }
}
fn vint(bytes: &[u8], offset: &mut usize, keep_marker: bool) -> Option<u64> {
    let first = *bytes.get(*offset)?;
    let width = first.leading_zeros() as usize + 1;
    if width > 8 {
        return None;
    }
    let mut value = if keep_marker {
        u64::from(first)
    } else {
        u64::from(first) & (0xff_u64 >> width)
    };
    for index in 1..width {
        value = (value << 8) | u64::from(*bytes.get(*offset + index)?);
    }
    *offset += width;
    Some(value)
}
pub(crate) fn classify(bytes: &[u8]) -> Result<Family, AttemptFailure> {
    if bytes.len() >= 16 && &bytes[4..8] == b"ftyp" {
        let size = u32::from_be_bytes(bytes[..4].try_into().map_err(|_| unsupported())?) as usize;
        if size < 16 || size > bytes.len() || !(size - 16).is_multiple_of(4) {
            return Err(unsupported());
        }
        const BRANDS: &[[u8; 4]] = &[
            *b"isom", *b"iso2", *b"iso3", *b"iso4", *b"iso5", *b"iso6", *b"mp41", *b"mp42",
            *b"avc1", *b"M4V ", *b"M4A ", *b"qt  ", *b"dash", *b"MSNV", *b"3gp4", *b"3gp5",
            *b"3gp6", *b"3g2a",
        ];
        if !std::iter::once(&bytes[8..12])
            .chain(bytes[16..size].chunks_exact(4))
            .all(|brand| BRANDS.iter().any(|allowed| brand == allowed))
        {
            return Err(unsupported());
        }
        return Ok(Family::Mov);
    }
    if bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        let mut offset = 4;
        let size = usize::try_from(vint(bytes, &mut offset, false).ok_or_else(unsupported)?)
            .map_err(|_| unsupported())?;
        let end = offset
            .checked_add(size)
            .filter(|end| *end <= bytes.len())
            .ok_or_else(unsupported)?;
        let mut doc_type = None;
        while offset < end {
            let id = vint(&bytes[..end], &mut offset, true).ok_or_else(unsupported)?;
            let size =
                usize::try_from(vint(&bytes[..end], &mut offset, false).ok_or_else(unsupported)?)
                    .map_err(|_| unsupported())?;
            let next = offset
                .checked_add(size)
                .filter(|next| *next <= end)
                .ok_or_else(unsupported)?;
            if id == 0x4282 {
                if doc_type.is_some() {
                    return Err(unsupported());
                }
                doc_type = Some(&bytes[offset..next]);
            }
            offset = next;
        }
        if matches!(doc_type, Some(b"webm" | b"matroska")) {
            return Ok(Family::Matroska);
        }
    }
    Err(unsupported())
}
async fn family(storage: &MediaStorage, input: &LocalFile) -> Result<Family, AttemptFailure> {
    let permit = storage
        .workers
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| AttemptFailure::new(FailureCode::Worker, e))?;
    let mut file = input
        .handle()
        .try_clone()
        .map_err(|e| AttemptFailure::new(FailureCode::FileAccess, e))?;
    let max = storage.config.max_input_bytes;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        if file
            .metadata()
            .map_err(|e| AttemptFailure::new(FailureCode::FileAccess, e))?
            .len()
            > max
        {
            return Err(AttemptFailure::new(
                FailureCode::Limit,
                "video input byte budget",
            ));
        }
        file.rewind()
            .map_err(|e| AttemptFailure::new(FailureCode::FileAccess, e))?;
        let mut bytes = Vec::new();
        file.take(64 * 1024)
            .read_to_end(&mut bytes)
            .map_err(|e| AttemptFailure::new(FailureCode::FileAccess, e))?;
        classify(&bytes)
    })
    .await
    .map_err(|e| AttemptFailure::new(FailureCode::Worker, e))?
}
fn args(values: &[&str]) -> Vec<OsString> {
    values.iter().map(OsString::from).collect()
}
fn input_args(storage: &MediaStorage, family: Family) -> Vec<OsString> {
    let mut args = args(&[
        "-v",
        "error",
        "-max_alloc",
        &storage.config.max_allocation.to_string(),
        "-threads",
        "1",
        "-probesize",
        "5000000",
        "-analyzeduration",
        "5000000",
        "-protocol_whitelist",
        "file",
        "-format_whitelist",
        family.name(),
        "-f",
        family.name(),
    ]);
    if family == Family::Mov {
        args.extend(crate::video::args(&[
            "-enable_drefs",
            "0",
            "-use_absolute_path",
            "0",
        ]));
    }
    args
}
pub(crate) async fn inspect(
    storage: &MediaStorage,
    input: LocalFile,
) -> Result<VideoFacts, AttemptFailure> {
    let family = family(storage, &input).await?;
    let mut args = input_args(storage, family);
    args.extend(crate::video::args(&["-show_streams", "-of", "json"]));
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
pub(crate) async fn cover(
    storage: &MediaStorage,
    input: LocalFile,
    facts: &VideoFacts,
    edge: u32,
) -> Result<Vec<u8>, AttemptFailure> {
    if facts
        .width
        .is_some_and(|v| v > storage.config.max_dimension)
        || facts
            .height
            .is_some_and(|v| v > storage.config.max_dimension)
        || facts
            .width
            .zip(facts.height)
            .is_some_and(|(w, h)| u64::from(w) * u64::from(h) > storage.config.max_pixels)
    {
        return Err(AttemptFailure::new(
            FailureCode::Limit,
            "video source raster budget",
        ));
    }
    let stream = facts.stream_index;
    let family = family(storage, &input).await?;
    let mut args = input_args(storage, family);
    args.extend(crate::video::args(&[
        "-nostdin",
        "-noautorotate",
        "-max_pixels",
        &storage.config.max_pixels.to_string(),
        "-i",
    ]));
    args.push(input.path().as_os_str().to_owned());
    args.extend(crate::video::args(&[
        "-map",
        &format!("0:{stream}"),
        "-an",
        "-sn",
        "-dn",
        "-frames:v",
        "1",
        "-threads",
        "1",
        "-filter_threads",
        "1",
        "-vf",
        &format!(
            "scale=w='min({edge},iw)':h='min({edge},ih)':force_original_aspect_ratio=decrease"
        ),
        "-c:v",
        "png",
        "-f",
        "image2pipe",
        "pipe:1",
    ]));
    let bytes = process::run(
        storage,
        &storage.config.ffmpeg,
        args,
        storage.config.max_output_bytes,
    )
    .await?;
    if bytes.is_empty() {
        return Err(AttemptFailure::new(
            FailureCode::NoFrame,
            "no decodable first frame",
        ));
    }
    let permit = storage
        .workers
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| AttemptFailure::new(FailureCode::Worker, e))?;
    let config = storage.config.clone();
    let bytes = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        crate::image_adapter::validate_png(&bytes, edge, &config)?;
        Ok::<_, AttemptFailure>(bytes)
    })
    .await
    .map_err(|e| AttemptFailure::new(FailureCode::Worker, e))??;
    Ok(bytes)
}

#[cfg(test)]
#[path = "video_tests.rs"]
mod tests;
