use super::identify::Family;
use crate::service::MediaService;
use std::ffi::OsString;

pub(super) fn args(values: &[&str]) -> Vec<OsString> {
    values.iter().map(OsString::from).collect()
}
pub(super) fn input_args(storage: &MediaService, family: Family) -> Vec<OsString> {
    let mut args = args(&[
        "-v",
        "error",
        "-max_alloc",
        &storage.config.max_allocation.to_string(),
        "-threads",
        "1",
        "-probesize",
        "5000000",
        "-analyzeduration",
        "5000000",
        "-protocol_whitelist",
        "file",
        "-format_whitelist",
        family.name(),
        "-f",
        family.name(),
    ]);
    if family == Family::Mov {
        args.extend(self::args(&[
            "-enable_drefs",
            "0",
            "-use_absolute_path",
            "0",
        ]));
    }
    args
}
