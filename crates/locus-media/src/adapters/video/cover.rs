use super::{
    command::{self, input_args},
    identify::family,
};
use crate::{
    adapters::process,
    error::{AttemptFailure, FailureCode},
    facts::VideoFacts,
    service::MediaService,
};
use locus_file::api::LocalFile;

pub(crate) async fn cover(
    storage: &MediaService,
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
    args.extend(command::args(&[
        "-nostdin",
        "-noautorotate",
        "-max_pixels",
        &storage.config.max_pixels.to_string(),
        "-i",
    ]));
    args.push(input.path().as_os_str().to_owned());
    args.extend(command::args(&[
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
    let bytes = storage
        .blocking(move || {
            let _permit = permit;
            crate::adapters::image::validate_png(&bytes, edge, &config)?;
            Ok::<_, AttemptFailure>(bytes)
        })
        .await
        .map_err(|e| AttemptFailure::new(FailureCode::Worker, e))??;
    Ok(bytes)
}
