use locus_settings::api::{GroupId, Provider};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;

pub const EXTERNAL_ADDRESS: GroupId = GroupId::from_u128(0x8bf9fb31_5633_44ca_956d_ef2b373c61af);
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ExternalAddress {
    pub address: String,
}
pub struct ExternalAddressProvider;
impl Provider for ExternalAddressProvider {
    type Value = ExternalAddress;
    fn group_id(&self) -> GroupId {
        EXTERNAL_ADDRESS
    }
    fn name(&self) -> &'static str {
        "ExternalAddress"
    }
    fn version(&self) -> u32 {
        1
    }
    fn defaults(&self) -> Self::Value {
        ExternalAddress {
            address: "127.0.0.1:46321".into(),
        }
    }
    fn validate(&self, value: &Self::Value) -> Result<(), String> {
        let address: SocketAddr = value
            .address
            .parse()
            .map_err(|_| "Use a loopback socket address, such as 127.0.0.1:46321")?;
        if !address.ip().is_loopback() || address.port() == 0 {
            return Err("The external address must use a loopback IP and a nonzero port".into());
        }
        Ok(())
    }
}
