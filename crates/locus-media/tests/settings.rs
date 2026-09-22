#![allow(clippy::expect_used, clippy::unwrap_used)]
use locus_media::api::{MediaConfig, MediaToolPaths, MediaToolPathsProvider};
use locus_settings::api::Provider;
#[test]
fn complete_tool_paths_validate_without_probing_the_environment() {
    let owner = MediaToolPathsProvider;
    let default = owner.defaults();
    let config = MediaConfig::default();
    assert_eq!(config.ffprobe, std::path::PathBuf::from(&default.ffprobe));
    assert_eq!(config.ffmpeg, std::path::PathBuf::from(&default.ffmpeg));
    for path in [
        "custom-tool",
        "/absent/test-owned/tool",
        "relative path/tool",
    ] {
        assert!(
            owner
                .validate(&MediaToolPaths {
                    ffprobe: path.into(),
                    ffmpeg: path.into()
                })
                .is_ok()
        );
    }
    for path in ["", "bad\0path"] {
        assert!(
            owner
                .validate(&MediaToolPaths {
                    ffprobe: path.into(),
                    ffmpeg: default.ffmpeg.clone()
                })
                .is_err()
        );
        assert!(
            owner
                .validate(&MediaToolPaths {
                    ffprobe: default.ffprobe.clone(),
                    ffmpeg: path.into()
                })
                .is_err()
        );
    }
}
