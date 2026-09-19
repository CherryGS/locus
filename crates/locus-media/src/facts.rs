use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImageFormat {
    Png,
    Jpeg,
    WebP,
    Gif,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImageFacts {
    pub format: ImageFormat,
    pub width: u32,
    pub height: u32,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DurationPrecision {
    Unknown,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StreamDuration {
    pub seconds: f64,
    pub precision: DurationPrecision,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VideoFacts {
    pub container: String,
    pub stream_index: u32,
    pub codec: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration: Option<StreamDuration>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Facts {
    Image(ImageFacts),
    Video(VideoFacts),
}
