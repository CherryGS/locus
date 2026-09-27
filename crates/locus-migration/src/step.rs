use crate::error::MigrationError;
use locus_store::api::{Context, TransactionFuture};
use sha2::{Digest, Sha256};

pub(crate) struct Input {
    pub path: &'static str,
    pub contents: &'static str,
}
pub(crate) struct Step {
    pub id: i64,
    pub name: &'static str,
    pub inputs: &'static [Input],
    pub run: for<'a> fn(&'a mut Context) -> TransactionFuture<'a, (), MigrationError>,
}
impl Step {
    pub fn checksum(&self) -> String {
        fingerprint(self.inputs)
    }
}
/// Length framing prevents ambiguous concatenations; logical paths and LF text
/// make fingerprints independent of checkout location and Windows line endings.
pub(crate) fn fingerprint(inputs: &[Input]) -> String {
    let mut digest = Sha256::new();
    digest.update(b"locus-migration-definition-v1");
    for input in inputs {
        let text = input.contents.replace("\r\n", "\n").replace('\r', "\n");
        for bytes in [input.path.as_bytes(), text.as_bytes()] {
            digest.update((bytes.len() as u64).to_be_bytes());
            digest.update(bytes);
        }
    }
    format!("{:x}", digest.finalize())
}
