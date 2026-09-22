use crate::{error::SettingsError, identity::GroupId, record::Definition};
use schemars::JsonSchema;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use std::{collections::BTreeMap, sync::Arc};

/// Owner of a complete logical value. Serialization MUST retain all fields,
/// including null, empty and default-equal values. Do not use serde defaults or
/// skip rules to repair missing current data. Conversion must preserve old field
/// meanings; only new fields may acquire new defaults. Framework validation checks
/// a lossless JSON round trip but cannot infer a provider's semantic obligations.
pub trait Provider: Send + Sync + 'static {
    type Value: Serialize + DeserializeOwned + JsonSchema;
    fn group_id(&self) -> GroupId;
    fn name(&self) -> &'static str;
    fn version(&self) -> u32;
    fn defaults(&self) -> Self::Value;
    fn validate(&self, value: &Self::Value) -> Result<(), String>;
    fn supports(&self, _version: i64) -> bool {
        false
    }
    fn convert(&self, version: i64, _source: Value) -> Result<Self::Value, String> {
        Err(format!("unsupported payload version: {version}"))
    }
}
pub(crate) trait Erased: Send + Sync {
    fn definition(&self) -> Result<Definition, SettingsError>;
    fn validate(&self, value: Value) -> Result<Value, SettingsError>;
    fn supports(&self, version: i64) -> bool;
    fn convert(&self, version: i64, value: Value) -> Result<Value, SettingsError>;
}
struct Adapter<P>(P);
impl<P: Provider> Erased for Adapter<P> {
    fn definition(&self) -> Result<Definition, SettingsError> {
        let defaults = self.0.defaults();
        // Validate typed outputs before encoding: JSON turns nonfinite floats
        // into null, which could otherwise hide an invalid optional value.
        self.0.validate(&defaults).map_err(SettingsError::Invalid)?;
        let defaults = serde_json::to_value(defaults).map_err(invalid)?;
        Ok(Definition {
            group_id: self.0.group_id().to_string(),
            name: self.0.name().into(),
            version: self.0.version(),
            schema: serde_json::to_value(schemars::schema_for!(P::Value)).map_err(invalid)?,
            defaults: self.validate(defaults)?,
        })
    }
    fn validate(&self, value: Value) -> Result<Value, SettingsError> {
        let typed: P::Value = serde_json::from_value(value.clone()).map_err(invalid)?;
        self.0.validate(&typed).map_err(SettingsError::Invalid)?;
        let encoded = serde_json::to_value(typed).map_err(invalid)?;
        if !same_value(&encoded, &value) {
            return Err(SettingsError::Invalid(
                "value is not a complete lossless representation".into(),
            ));
        }
        Ok(encoded)
    }
    fn supports(&self, version: i64) -> bool {
        self.0.supports(version)
    }
    fn convert(&self, version: i64, value: Value) -> Result<Value, SettingsError> {
        if !self.supports(version) {
            return Err(SettingsError::Unsupported(version));
        }
        let value = self
            .0
            .convert(version, value)
            .map_err(SettingsError::Invalid)?;
        self.0.validate(&value).map_err(SettingsError::Invalid)?;
        self.validate(serde_json::to_value(value).map_err(invalid)?)
    }
}
fn invalid(error: serde_json::Error) -> SettingsError {
    SettingsError::Invalid(error.to_string())
}
#[derive(Clone, Default)]
pub struct Registry {
    providers: BTreeMap<GroupId, Arc<dyn Erased>>,
}
impl Registry {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn register<P: Provider>(&mut self, provider: P) -> Result<(), SettingsError> {
        let id = provider.group_id();
        if self.providers.contains_key(&id) {
            return Err(SettingsError::Duplicate(id));
        }
        let adapter = Adapter(provider);
        adapter.definition()?;
        self.providers.insert(id, Arc::new(adapter));
        Ok(())
    }
    /// Pure definition export. Does not open, initialize or mutate a library.
    pub fn definitions(&self) -> Result<Vec<Definition>, SettingsError> {
        self.providers.values().map(|p| p.definition()).collect()
    }
    pub(crate) fn provider(&self, id: GroupId) -> Result<&dyn Erased, SettingsError> {
        self.providers
            .get(&id)
            .map(|p| p.as_ref())
            .ok_or(SettingsError::Unavailable(id))
    }
}

// JSON numbers have logical numeric meaning: an exact 1 / 1.0 round trip is
// valid, but converting a large integer to a rounded float is not lossless.
fn same_value(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) if a != b => {
            fn exact(integer: &serde_json::Number, float: &serde_json::Number) -> bool {
                let Some(f) = float.as_f64() else {
                    return false;
                };
                if !float.is_f64() || f.fract() != 0.0 {
                    return false;
                }
                if let Some(i) = integer.as_i64() {
                    return f as i128 == i128::from(i) && f == i as f64;
                }
                if let Some(i) = integer.as_u64() {
                    return f as i128 == i128::from(i) && f == i as f64;
                }
                false
            }
            exact(a, b) || exact(b, a)
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same_value(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(key, a)| b.get(key).is_some_and(|b| same_value(a, b)))
        }
        _ => a == b,
    }
}
