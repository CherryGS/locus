use super::dto::SettingsDefinition;
/// Deterministic provider schemas and complete defaults, without a library.
pub fn settings_definitions() -> anyhow::Result<Vec<SettingsDefinition>> {
    Ok(crate::runtime::settings_setup::registry()?
        .definitions()?
        .into_iter()
        .map(|d| SettingsDefinition {
            group_id: d.group_id,
            name: d.name,
            version: d.version,
            schema: d.schema,
            defaults: d.defaults,
        })
        .collect())
}
