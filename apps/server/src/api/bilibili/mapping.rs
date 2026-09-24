use super::dto::*;
use locus_bilibili::api as source;
pub(crate) fn snapshot(v: source::BilibiliSnapshot) -> BilibiliSnapshot {
    BilibiliSnapshot {
        bvid: v.bvid,
        aid: v.aid,
        page_url: v.page_url,
        requested_url: v.requested_url,
        title: v.title,
        description: v.description,
        author: v.author.map(author),
        published_at_unix_ms: v.published_at_unix_ms.map(|v| v.to_string()),
        observed_at_unix_ms: v.observed_at_unix_ms.map(|v| v.to_string()),
        tags: v.tags,
        part: v.part.map(part),
        representation: v.representation.map(representation),
        preview: v.preview.map(preview),
        issues: v.issues.map(|v| v.into_iter().map(issue).collect()),
    }
}
pub(crate) fn author(v: source::AuthorObservation) -> BilibiliAuthorObservation {
    BilibiliAuthorObservation {
        user_id: v.user_id,
        display_name: v.display_name,
        profile_url: v.profile_url,
    }
}
pub(crate) fn part(v: source::PartObservation) -> BilibiliPartObservation {
    BilibiliPartObservation {
        cid: v.cid,
        number: v.number,
        title: v.title,
        claims: v.claims.map(claims),
    }
}
pub(crate) fn claims(v: source::MediaClaims) -> BilibiliMediaClaims {
    BilibiliMediaClaims {
        width: v.width,
        height: v.height,
        duration_ms: v.duration_ms.map(|v| v.to_string()),
        mime_type: v.mime_type,
        bitrate_bps: v.bitrate_bps.map(|v| v.to_string()),
        quality: v.quality,
    }
}
pub(crate) fn representation(v: source::SelectedRepresentation) -> BilibiliSelectedRepresentation {
    BilibiliSelectedRepresentation {
        url: v.url,
        claims: v.claims.map(claims),
    }
}
pub(crate) fn preview(v: source::RemotePreview) -> BilibiliRemotePreview {
    BilibiliRemotePreview {
        url: v.url,
        description: v.description,
        claims: v.claims.map(claims),
    }
}
pub(crate) fn issue(v: source::CaptureIssue) -> BilibiliCaptureIssue {
    BilibiliCaptureIssue {
        portion: match v.portion {
            source::CapturePortion::Submission => BilibiliCapturePortion::Submission,
            source::CapturePortion::Author => BilibiliCapturePortion::Author,
            source::CapturePortion::PublicationTime => BilibiliCapturePortion::PublicationTime,
            source::CapturePortion::Tags => BilibiliCapturePortion::Tags,
            source::CapturePortion::Part => BilibiliCapturePortion::Part,
            source::CapturePortion::SelectedRepresentation => {
                BilibiliCapturePortion::SelectedRepresentation
            }
            source::CapturePortion::RemotePreview => BilibiliCapturePortion::RemotePreview,
        },
        code: v.code,
        message: v.message,
    }
}
use crate::api::{core::mapping as core, file::mapping as file, store};
pub(crate) fn failure(e: source::BilibiliError) -> BilibiliFailure {
    use source::BilibiliError as E;
    match e {
        E::Core(e) => BilibiliFailure::Core {
            error: core::core_failure(&e),
        },
        E::File(e) => BilibiliFailure::File {
            diagnostic: file::diagnostic(&e),
        },
        E::Store(e) => BilibiliFailure::Store {
            diagnostic: store::diagnostic(&e),
        },
        E::MissingRecord(id) => BilibiliFailure::MissingRecord {
            component_id: id.to_string(),
        },
        E::Corrupt(message) => BilibiliFailure::Corrupt { message },
        E::PayloadVersion(version) => BilibiliFailure::PayloadVersion { version },
        E::SchemaVersion(version) => BilibiliFailure::SchemaVersion { version },
        e => BilibiliFailure::Other {
            message: e.to_string(),
        },
    }
}
pub(crate) fn view(v: source::BilibiliView) -> BilibiliView {
    BilibiliView {
        record: BilibiliRecord {
            component_id: v.record.id.to_string(),
            kind_id: source::BILIBILI_KIND.to_string(),
            revision: v.record.revision.to_string(),
            basis: v.record.basis.map(|v| v.to_string()),
            snapshot: snapshot(v.record.snapshot),
            original_cover: v.record.original_cover.map(|t| BilibiliOriginalCover {
                entity_id: t.entity.to_string(),
                file_id: t.file.to_string(),
            }),
        },
        cover: match v.cover {
            source::CoverApplicability::Unassociated => BilibiliCoverApplicability::Unassociated,
            source::CoverApplicability::Error(e) => BilibiliCoverApplicability::Error {
                diagnostic: file::diagnostic(&e),
            },
            source::CoverApplicability::Input {
                comparison: c,
                file_error,
            } => BilibiliCoverApplicability::Input {
                comparison: comparison(c),
                file_error: file_error.map(|e| file::diagnostic(&e)),
            },
        },
        applicability: match v.applicability {
            source::BilibiliApplicability::Unmounted => BilibiliApplicability::Unmounted,
            source::BilibiliApplicability::Error(e) => {
                BilibiliApplicability::Error { error: failure(e) }
            }
            source::BilibiliApplicability::Input {
                host,
                comparison,
                file_error,
            } => BilibiliApplicability::Input {
                host: host.to_string(),
                file_error: file_error.map(|e| file::diagnostic(&e)),
                comparison: match comparison {
                    locus_file::api::InputComparison::Matching(id) => {
                        BilibiliComparison::Matching {
                            file_id: id.to_string(),
                        }
                    }
                    locus_file::api::InputComparison::Changed { basis, current } => {
                        BilibiliComparison::Changed {
                            basis: basis.to_string(),
                            current: current.to_string(),
                        }
                    }
                    locus_file::api::InputComparison::Incomplete { basis, current } => {
                        BilibiliComparison::Incomplete {
                            basis: basis.map(|v| v.to_string()),
                            current: file::current(current),
                        }
                    }
                },
            },
        },
    }
}

fn comparison(v: locus_file::api::InputComparison) -> BilibiliComparison {
    match v {
        locus_file::api::InputComparison::Matching(id) => BilibiliComparison::Matching {
            file_id: id.to_string(),
        },
        locus_file::api::InputComparison::Changed { basis, current } => {
            BilibiliComparison::Changed {
                basis: basis.to_string(),
                current: current.to_string(),
            }
        }
        locus_file::api::InputComparison::Incomplete { basis, current } => {
            BilibiliComparison::Incomplete {
                basis: basis.map(|v| v.to_string()),
                current: file::current(current),
            }
        }
    }
}
