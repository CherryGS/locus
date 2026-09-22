use locus_settings::api::{GroupId, Provider};
use serde::{Deserialize, Serialize};

pub const MEDIA_TOOL_PATHS: GroupId = GroupId::from_u128(0x25c3fd2a_4148_4cb3_aca4_47c3ce3402e5);
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MediaToolPaths {
    pub ffprobe: String,
    pub ffmpeg: String,
}
impl Default for MediaToolPaths {
    fn default() -> Self {
        Self {
            ffprobe: "ffprobe".into(),
            ffmpeg: "ffmpeg".into(),
        }
    }
}
pub struct MediaToolPathsProvider;
impl Provider for MediaToolPathsProvider {
    type Value = MediaToolPaths;
    fn group_id(&self) -> GroupId {
        MEDIA_TOOL_PATHS
    }
    fn name(&self) -> &'static str {
        "MediaToolPaths"
    }
    fn version(&self) -> u32 {
        1
    }
    fn defaults(&self) -> Self::Value {
        MediaToolPaths::default()
    }
    fn validate(&self, value: &Self::Value) -> Result<(), String> {
        for (name, path) in [("ffprobe", &value.ffprobe), ("ffmpeg", &value.ffmpeg)] {
            if path.is_empty() || path.contains('\0') {
                return Err(format!(
                    "{name} must be a nonempty executable name or path without NUL"
                ));
            }
        }
        Ok(())
    }
}
