use super::dto::*;
use crate::api::{
    core::mapping as core_mapping,
    error::{Diagnostic, DomainDiagnostic, FailureKind},
    file::mapping as file_mapping,
    store,
};
use locus_file::api as file;
use locus_media::api as media;
pub(crate) fn media(error: media::MediaError) -> DomainDiagnostic {
    use media::MediaError as E;
    DomainDiagnostic::Media {
        error: match error {
            E::Core(e) => MediaFailure::Core {
                error: core_mapping::core_failure(&e),
            },
            E::File(e) => MediaFailure::File {
                diagnostic: file_mapping::diagnostic(&e),
            },
            E::Store(e) => MediaFailure::Store {
                diagnostic: store::diagnostic(&e),
            },
            E::MissingRecord(id) => MediaFailure::MissingRecord { target: target(id) },
            E::Attempt(e) => MediaFailure::Attempt {
                failure: attempt(e),
            },
            E::Cache(message) => MediaFailure::Cache { message },
            E::PreviewAccess(e) => MediaFailure::PreviewAccess {
                diagnostic: Diagnostic {
                    kind: match e.kind() {
                        std::io::ErrorKind::PermissionDenied => FailureKind::AccessDenied,
                        std::io::ErrorKind::NotFound => FailureKind::ManagedBytesMissing,
                        _ => FailureKind::Io,
                    },
                    message: e.to_string(),
                },
            },
            e => MediaFailure::Other {
                message: e.to_string(),
            },
        },
    }
}
pub(crate) fn kind(k: media::MediaKind) -> MediaKind {
    match k {
        media::MediaKind::Image => MediaKind::Image,
        media::MediaKind::Video => MediaKind::Video,
    }
}
pub(crate) fn target(id: media::MediaId) -> MediaTarget {
    MediaTarget {
        kind: kind(id.kind()),
        component_id: id.component().to_string(),
    }
}
pub(crate) fn attempt(a: media::AttemptFailure) -> AttemptFailure {
    use media::FailureCode as F;
    AttemptFailure {
        code: match a.code {
            F::MissingInput => AttemptCode::MissingInput,
            F::FileAccess => AttemptCode::FileAccess,
            F::UnsupportedInput => AttemptCode::UnsupportedInput,
            F::Decode => AttemptCode::Decode,
            F::Limit => AttemptCode::Limit,
            F::Timeout => AttemptCode::Timeout,
            F::ToolUnavailable => AttemptCode::ToolUnavailable,
            F::ToolFailure => AttemptCode::ToolFailure,
            F::MalformedOutput => AttemptCode::MalformedOutput,
            F::NoFrame => AttemptCode::NoFrame,
            F::Worker => AttemptCode::Worker,
        },
        detail: a.detail,
    }
}
pub(crate) fn record(r: media::MediaRecord) -> MediaRecord {
    MediaRecord {
        target: target(r.id),
        revision: r.revision.to_string(),
        basis: r.basis.map(|id| id.to_string()),
        last_failure: r.last_failure.map(attempt),
        facts: r.facts.map(|f| match f {
            media::Facts::Image(f) => MediaFacts::Image {
                format: match f.format {
                    media::ImageFormat::Png => ImageFormat::Png,
                    media::ImageFormat::Jpeg => ImageFormat::Jpeg,
                    media::ImageFormat::WebP => ImageFormat::WebP,
                    media::ImageFormat::Gif => ImageFormat::Gif,
                },
                width: f.width,
                height: f.height,
            },
            media::Facts::Video(f) => MediaFacts::Video {
                container: f.container,
                stream_index: f.stream_index,
                codec: f.codec,
                width: f.width,
                height: f.height,
                duration: f.duration.map(|d| StreamDuration {
                    seconds: d.seconds,
                    precision: DurationPrecision::Unknown,
                }),
            },
        }),
    }
}
pub(crate) fn view(v: media::MediaView) -> MediaView {
    let applicability = match v.applicability {
        media::Applicability::Unmounted => Applicability::Unmounted,
        media::Applicability::Error(e) => Applicability::Error {
            diagnostic: media(e),
        },
        media::Applicability::Input(i) => match i {
            file::InputComparison::Matching(id) => Applicability::Matching {
                file_id: id.to_string(),
            },
            file::InputComparison::Changed { basis, current } => Applicability::Changed {
                basis: basis.to_string(),
                current: current.to_string(),
            },
            file::InputComparison::Incomplete { basis, current } => Applicability::Incomplete {
                basis: basis.map(|id| id.to_string()),
                current: file_mapping::current(current),
            },
        },
    };
    MediaView {
        record: record(v.record),
        applicability,
    }
}
pub(crate) fn entry(e: media::MediaEntry) -> MediaEntry {
    MediaEntry {
        membership: core_mapping::membership(e.membership),
        result: match e.result {
            Ok(v) => MediaEntryResult::Readable { view: view(v) },
            Err(e) => MediaEntryResult::Failed {
                diagnostic: media(e),
            },
        },
    }
}
