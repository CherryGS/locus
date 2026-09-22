use crate::api::settings::dto::{EffectiveToolPath, MediaSettingsRuntime};
use locus_media::api::{MEDIA_TOOL_PATHS, MediaConfig, MediaToolPaths, MediaToolPathsProvider};
use locus_settings::api::{Observation, Registry, SettingsService, WriteOutcome};
use locus_store::api::TaskDatabase;
use locus_task::api::TaskQueue;

pub(crate) fn registry() -> Result<Registry, locus_settings::api::SettingsError> {
    let mut registry = Registry::new();
    registry.register(MediaToolPathsProvider)?;
    Ok(registry)
}
pub(crate) async fn prepare(
    queue: &TaskQueue,
    database: &TaskDatabase,
) -> anyhow::Result<(SettingsService, MediaConfig, MediaSettingsRuntime)> {
    let settings = SettingsService::new(registry()?);
    let service = settings.clone();
    let database = database.clone();
    let saved=queue.submit("Prepare Media settings",move |task| async move {
        let mut session=database.session(&task).await?;
        service.initialize_schema(&mut session).await?;
        let observation=match service.initialize(&mut session,MEDIA_TOOL_PATHS).await? {
            WriteOutcome::Saved(saved)=>Observation::Current { saved },
            WriteOutcome::Existing(value)=>value,
            WriteOutcome::Conflict(_)=>anyhow::bail!("unexpected initialization conflict"),
        };
        let observation=match observation {
            Observation::ConversionRequired { metadata, source, .. }=>match service.convert(&mut session,MEDIA_TOOL_PATHS,metadata,source).await? {
                WriteOutcome::Saved(saved)=>Observation::Current { saved },
                _=>anyhow::bail!("Media settings changed during conversion; start again to observe current values"),
            },
            value=>value,
        };
        match observation { Observation::Current { saved }=>Ok(saved), value=>anyhow::bail!("Media saved settings unavailable: {value:?}") }
    })?.result().await??;
    let paths: MediaToolPaths = serde_json::from_value(saved.value.clone())?;
    let ffprobe = effective("LOCUS_FFPROBE", paths.ffprobe)?;
    let ffmpeg = effective("LOCUS_FFMPEG", paths.ffmpeg)?;
    let config = MediaConfig {
        ffprobe: ffprobe.path.clone().into(),
        ffmpeg: ffmpeg.path.clone().into(),
        ..MediaConfig::default()
    };
    let runtime = MediaSettingsRuntime {
        captured: crate::api::settings::mapping::saved(saved),
        ffprobe,
        ffmpeg,
    };
    Ok((settings, config, runtime))
}
fn effective(variable: &str, saved: String) -> anyhow::Result<EffectiveToolPath> {
    match std::env::var_os(variable) {
        Some(path) => Ok(EffectiveToolPath {
            path: path
                .into_string()
                .map_err(|_| anyhow::anyhow!("{variable} is not valid Unicode"))?,
            environment: Some(variable.into()),
        }),
        None => Ok(EffectiveToolPath {
            path: saved,
            environment: None,
        }),
    }
}
