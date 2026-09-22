use std::{path::PathBuf, time::Duration};

/// Work budgets, not a process sandbox or a hard memory/cancellation guarantee.
#[derive(Debug, Clone)]
pub struct MediaConfig {
    pub ffprobe: PathBuf,
    pub ffmpeg: PathBuf,
    pub max_input_bytes: u64,
    pub max_dimension: u32,
    pub max_pixels: u64,
    pub max_allocation: u64,
    pub max_output_bytes: usize,
    pub max_parallel: usize,
    pub process_timeout: Duration,
}
impl Default for MediaConfig {
    fn default() -> Self {
        let paths = crate::settings::MediaToolPaths::default();
        Self {
            ffprobe: paths.ffprobe.into(),
            ffmpeg: paths.ffmpeg.into(),
            max_input_bytes: 512 * 1024 * 1024,
            max_dimension: 32768,
            max_pixels: 40_000_000,
            max_allocation: 320_000_000,
            max_output_bytes: 8 * 1024 * 1024,
            max_parallel: 2,
            process_timeout: Duration::from_secs(30),
        }
    }
}
