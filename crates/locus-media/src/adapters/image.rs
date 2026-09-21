use crate::{
    config::MediaConfig,
    error::{AttemptFailure, FailureCode},
    facts::{ImageFacts, ImageFormat},
    service::MediaService,
};
use image::{ImageEncoder, ImageReader, Limits, codecs::png::PngEncoder};
use locus_file::api::LocalFile;
use std::io::{BufReader, Cursor, Write};

fn fail(error: impl ToString) -> AttemptFailure {
    AttemptFailure::new(FailureCode::Decode, error)
}
fn io_failure(error: std::io::Error) -> AttemptFailure {
    AttemptFailure::new(FailureCode::FileAccess, error)
}
fn image_failure(error: image::ImageError) -> AttemptFailure {
    let code = match &error {
        image::ImageError::IoError(_) => FailureCode::FileAccess,
        image::ImageError::Limits(_) => FailureCode::Limit,
        image::ImageError::Unsupported(_) => FailureCode::UnsupportedInput,
        _ => FailureCode::Decode,
    };
    AttemptFailure::new(code, error)
}
fn dimensions(config: &MediaConfig, width: u32, height: u32) -> Result<(), AttemptFailure> {
    let pixels = u64::from(width).checked_mul(u64::from(height));
    if width == 0
        || height == 0
        || width > config.max_dimension
        || height > config.max_dimension
        || pixels.is_none_or(|n| {
            n > config.max_pixels || n.checked_mul(16).is_none_or(|n| n > config.max_allocation)
        })
    {
        return Err(AttemptFailure::new(
            FailureCode::Limit,
            "raster dimension/pixel/allocation budget",
        ));
    }
    Ok(())
}
fn reader(
    input: LocalFile,
    config: &MediaConfig,
) -> Result<ImageReader<BufReader<locus_file::api::FileInput>>, AttemptFailure> {
    if input.handle().metadata().map_err(io_failure)?.len() > config.max_input_bytes {
        return Err(AttemptFailure::new(FailureCode::Limit, "input byte budget"));
    }
    let mut reader = ImageReader::new(BufReader::new(input.into_reader()))
        .with_guessed_format()
        .map_err(io_failure)?;
    if !matches!(
        reader.format(),
        Some(
            image::ImageFormat::Png
                | image::ImageFormat::Jpeg
                | image::ImageFormat::WebP
                | image::ImageFormat::Gif
        )
    ) {
        return Err(AttemptFailure::new(
            FailureCode::UnsupportedInput,
            "Image supports PNG/JPEG/WebP/GIF by content",
        ));
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(config.max_dimension);
    limits.max_image_height = Some(config.max_dimension);
    limits.max_alloc = Some(config.max_allocation);
    reader.limits(limits);
    Ok(reader)
}
pub(crate) async fn inspect(
    storage: &MediaService,
    input: LocalFile,
) -> Result<ImageFacts, AttemptFailure> {
    let permit = storage
        .workers
        .clone()
        .acquire_owned()
        .await
        .map_err(fail)?;
    let config = storage.config.clone();
    storage
        .blocking(move || {
            let _permit = permit;
            let reader = reader(input, &config)?;
            let format = match reader.format() {
                Some(image::ImageFormat::Png) => ImageFormat::Png,
                Some(image::ImageFormat::Jpeg) => ImageFormat::Jpeg,
                Some(image::ImageFormat::WebP) => ImageFormat::WebP,
                Some(image::ImageFormat::Gif) => ImageFormat::Gif,
                _ => {
                    return Err(AttemptFailure::new(
                        FailureCode::UnsupportedInput,
                        "unsupported format",
                    ));
                }
            };
            let (width, height) = reader.into_dimensions().map_err(image_failure)?;
            dimensions(&config, width, height)?;
            Ok(ImageFacts {
                format,
                width,
                height,
            })
        })
        .await
        .map_err(|e| AttemptFailure::new(FailureCode::Worker, e))?
}
pub(crate) async fn thumbnail(
    storage: &MediaService,
    input: LocalFile,
    edge: u32,
) -> Result<Vec<u8>, AttemptFailure> {
    let permit = storage
        .workers
        .clone()
        .acquire_owned()
        .await
        .map_err(fail)?;
    let config = storage.config.clone();
    storage
        .blocking(move || {
            let _permit = permit;
            // Inspect dimensions before allocating the raster, then rewind the input.
            let mut reader = reader(input, &config)?;
            let format = reader.format();
            let mut stream = reader.into_inner();
            let (width, height) = ImageReader::with_format(
                &mut stream,
                format.ok_or_else(|| fail("format missing"))?,
            )
            .into_dimensions()
            .map_err(image_failure)?;
            dimensions(&config, width, height)?;
            std::io::Seek::rewind(&mut stream).map_err(io_failure)?;
            reader = ImageReader::new(stream);
            reader.set_format(format.ok_or_else(|| fail("format missing"))?);
            let mut limits = Limits::default();
            limits.max_image_width = Some(config.max_dimension);
            limits.max_image_height = Some(config.max_dimension);
            limits.max_alloc = Some(config.max_allocation);
            reader.limits(limits);
            let raster = reader
                .decode()
                .map_err(image_failure)?
                .thumbnail(edge, edge)
                .to_rgba8();
            let mut output = BoundedOutput {
                bytes: Vec::new(),
                limit: config.max_output_bytes,
                exceeded: false,
            };
            let encoded = PngEncoder::new(&mut output).write_image(
                &raster,
                raster.width(),
                raster.height(),
                image::ExtendedColorType::Rgba8,
            );
            if output.exceeded {
                return Err(AttemptFailure::new(
                    FailureCode::Limit,
                    "PNG output byte budget",
                ));
            }
            encoded.map_err(fail)?;
            Ok(output.bytes)
        })
        .await
        .map_err(|e| AttemptFailure::new(FailureCode::Worker, e))?
}
struct BoundedOutput {
    bytes: Vec<u8>,
    limit: usize,
    exceeded: bool,
}
impl Write for BoundedOutput {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > self.limit.saturating_sub(self.bytes.len()) {
            self.exceeded = true;
            return Err(std::io::Error::other("PNG output byte budget"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
pub(crate) fn validate_png(
    bytes: &[u8],
    edge: u32,
    config: &MediaConfig,
) -> Result<(), AttemptFailure> {
    if bytes.len() > config.max_output_bytes {
        return Err(AttemptFailure::new(FailureCode::Limit, "PNG byte budget"));
    }
    let (width, height) = ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Png)
        .into_dimensions()
        .map_err(fail)?;
    dimensions(config, width, height)?;
    if width > edge || height > edge {
        return Err(fail("PNG dimensions"));
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Png);
    let mut limits = Limits::default();
    limits.max_image_width = Some(edge);
    limits.max_image_height = Some(edge);
    limits.max_alloc = Some(config.max_allocation);
    reader.limits(limits);
    let raster = reader.decode().map_err(fail)?;
    if raster.width() == 0
        || raster.height() == 0
        || raster.width() > edge
        || raster.height() > edge
    {
        return Err(fail("PNG dimensions"));
    }
    Ok(())
}

/// Supported format observation only: a match does not promise a decodable image.
pub(crate) async fn recognize(
    storage: &MediaService,
    input: LocalFile,
) -> Result<(), AttemptFailure> {
    let config = storage.config.clone();
    storage
        .blocking(move || reader(input, &config).map(|_| ()))
        .await
        .map_err(|e| AttemptFailure::new(FailureCode::Worker, e))?
}
