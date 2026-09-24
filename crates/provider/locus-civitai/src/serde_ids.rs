macro_rules! id_serde {
    ($module:ident,$ty:ty) => {
        pub(crate) mod $module {
            use serde::{Deserialize, Deserializer, Serialize, Serializer};
            pub fn serialize<S: Serializer>(id: &$ty, s: S) -> Result<S::Ok, S::Error> {
                id.as_bytes().serialize(s)
            }
            pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<$ty, D::Error> {
                let bytes = <[u8; 16]>::deserialize(d)?;
                <$ty>::from_bytes(&bytes).map_err(serde::de::Error::custom)
            }
        }
    };
}
id_serde!(entity, locus_core::api::EntityId);
id_serde!(file, locus_file::api::FileId);
id_serde!(component, locus_core::api::ComponentId);
