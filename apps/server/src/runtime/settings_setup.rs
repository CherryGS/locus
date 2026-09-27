use crate::api::settings::dto::{EffectiveToolPath, MediaSettingsRuntime};
use locus_media::api::{MEDIA_TOOL_PATHS, MediaConfig, MediaToolPaths, MediaToolPathsProvider};
use locus_settings::api::{Observation, Registry, SettingsService, WriteOutcome};
use locus_store::api::TaskDatabase;
use locus_task::api::TaskQueue;

pub(crate) fn registry() -> Result<Registry, locus_settings::api::SettingsError> {
    let mut registry = Registry::new();
    registry.register(MediaToolPathsProvider)?;
    registry.register(crate::access::settings::ExternalAddressProvider)?;
    Ok(registry)
}
pub(crate) async fn prepare(
    queue: &TaskQueue,
    database: &TaskDatabase,
    settings: &SettingsService,
) -> anyhow::Result<(MediaConfig, MediaSettingsRuntime)> {
    let service = settings.clone();
    let database = database.clone();
    let saved = queue
        .submit("Prepare Media settings", move |task| async move {
            let mut session = database.session(&task).await?;
            let observation = match service.initialize(&mut session, MEDIA_TOOL_PATHS).await? {
                WriteOutcome::Saved(saved) => Observation::Current { saved },
                WriteOutcome::Existing(value) => value,
                WriteOutcome::Conflict(_) => anyhow::bail!("unexpected initialization conflict"),
            };
            match observation {
                Observation::Current { saved } => Ok(saved),
                value => anyhow::bail!("{}", unavailable(value)),
            }
        })?
        .result()
        .await??;
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
    Ok((config, runtime))
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

pub(crate) async fn prepare_external(
    queue: &TaskQueue,
    database: &TaskDatabase,
    settings: &SettingsService,
) -> anyhow::Result<crate::api::settings::dto::SavedSettings> {
    let database = database.clone();
    let service = settings.clone();
    queue.submit("Prepare external address",move |task| async move {
        let mut session=database.session(&task).await?;
        let observation=match service.initialize(&mut session,crate::access::settings::EXTERNAL_ADDRESS).await? {
            WriteOutcome::Saved(saved)=>Observation::Current{saved},
            WriteOutcome::Existing(v)=>v,
            WriteOutcome::Conflict(_)=>anyhow::bail!("External address changed during initialization"),
        };
        match observation {
            Observation::Current{saved}=>Ok(crate::api::settings::mapping::saved(saved)),
            _=>anyhow::bail!("Required external address configuration is unavailable; repair Settings and restart"),
        }
    })?.result().await?
}

fn unavailable(value: Observation) -> String {
    match value {
        Observation::Corrupt { message, .. } | Observation::Invalid { message, .. } => {
            format!("Saved Media settings are invalid: {message}")
        }
        Observation::Unsupported { metadata, .. } => format!(
            "Saved Media settings version {} is unsupported by this application",
            metadata.version
        ),
        Observation::Unavailable { .. } => {
            "The saved Media settings definition is unavailable".into()
        }
        Observation::Absent { .. } => "Saved Media settings were not initialized".into(),
        Observation::Current { .. } => "Media settings preparation failed".into(),
    }
}
