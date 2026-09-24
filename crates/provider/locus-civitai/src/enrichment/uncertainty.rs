use crate::error::CivitaiError;
use locus_core::api::CoreError;
use locus_file::api::FileError;
use locus_media::api::MediaError;
use locus_store::api::StoreError;
fn store(e: &StoreError) -> bool {
    matches!(
        e,
        StoreError::CommitOutcomeUnknown(_) | StoreError::RollbackFailed { .. }
    )
}
fn core(e: &CoreError) -> bool {
    matches!(e,CoreError::Store(e) if store(e))
}
pub(crate) fn file_uncertain(e: &FileError) -> bool {
    match e {
        FileError::Store(e) => store(e),
        FileError::Core(e) => core(e),
        _ => false,
    }
}
fn media(e: &MediaError) -> bool {
    match e {
        MediaError::Store(e) => store(e),
        MediaError::Core(e) => core(e),
        MediaError::File(e) => file_uncertain(e),
        _ => false,
    }
}
/// Inspect typed owner errors: transparent Error::source implementations can
/// intentionally omit the wrapped StoreError from a generic source chain.
pub(crate) fn uncertain(e: &CivitaiError) -> bool {
    match e {
        CivitaiError::Store(e) => store(e),
        CivitaiError::Core(e) => core(e),
        CivitaiError::File(e) => file_uncertain(e),
        CivitaiError::Media(e) => media(e),
        _ => false,
    }
}
#[cfg(test)]
#[test]
fn transparent_owner_wrappers_never_erase_commit_uncertainty() {
    let unknown = || StoreError::CommitOutcomeUnknown(diesel::result::Error::RollbackTransaction);
    for error in [
        CivitaiError::Store(unknown()),
        CivitaiError::Core(CoreError::Store(unknown())),
        CivitaiError::File(FileError::Core(CoreError::Store(unknown()))),
        CivitaiError::File(FileError::Store(unknown())),
        CivitaiError::Media(MediaError::Store(unknown())),
        CivitaiError::Media(MediaError::File(FileError::Core(CoreError::Store(
            unknown(),
        )))),
    ] {
        assert!(uncertain(&error));
    }
}
