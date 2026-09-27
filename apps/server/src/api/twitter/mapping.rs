use super::dto::*;
use crate::api::{core::mapping as core, file::mapping as file, store};
use locus_twitter::api as source;
fn twitter_snapshot(v: source::TwitterSnapshot) -> TwitterSnapshot {
    TwitterSnapshot {
        post_id: v.post_id,
        page_url: v.page_url,
        requested_url: v.requested_url,
        text: v.text,
        author: v.author.map(author_observation),
        published_at_unix_ms: v.published_at_unix_ms.map(|v| v.to_string()),
        observed_at_unix_ms: v.observed_at_unix_ms.map(|v| v.to_string()),
        hashtags: v.hashtags,
        references: v
            .references
            .map(|v| v.into_iter().map(provider_reference).collect()),
        occurrence: v.occurrence.map(media_occurrence),
        representation: v.representation.map(selected_representation),
        preview: v.preview.map(remote_preview),
        issues: v.issues.map(|v| v.into_iter().map(capture_issue).collect()),
    }
}
fn author_observation(v: source::AuthorObservation) -> TwitterAuthorObservation {
    TwitterAuthorObservation {
        user_id: v.user_id,
        handle: v.handle,
        display_name: v.display_name,
        profile_url: v.profile_url,
    }
}
fn reference_kind(v: source::ReferenceKind) -> TwitterReferenceKind {
    match v {
        source::ReferenceKind::ReplyTo => TwitterReferenceKind::ReplyTo,
        source::ReferenceKind::Quote => TwitterReferenceKind::Quote,
        source::ReferenceKind::Repost => TwitterReferenceKind::Repost,
    }
}
fn provider_reference(v: source::ProviderReference) -> TwitterProviderReference {
    TwitterProviderReference {
        kind: reference_kind(v.kind),
        post_id: v.post_id,
        page_url: v.page_url,
    }
}
fn media_label(v: source::MediaLabel) -> TwitterMediaLabel {
    match v {
        source::MediaLabel::Photo => TwitterMediaLabel::Photo,
        source::MediaLabel::Video => TwitterMediaLabel::Video,
        source::MediaLabel::AnimatedImage => TwitterMediaLabel::AnimatedImage,
    }
}
fn media_claims(v: source::MediaClaims) -> TwitterMediaClaims {
    TwitterMediaClaims {
        width: v.width,
        height: v.height,
        duration_ms: v.duration_ms.map(|v| v.to_string()),
        mime_type: v.mime_type,
        bitrate_bps: v.bitrate_bps.map(|v| v.to_string()),
        quality: v.quality,
    }
}
fn media_occurrence(v: source::MediaOccurrence) -> TwitterMediaOccurrence {
    TwitterMediaOccurrence {
        media_id: v.media_id,
        capture_local_id: v.capture_local_id,
        source_order: v.source_order,
        label: v.label.map(media_label),
        alt_text: v.alt_text,
        claims: v.claims.map(media_claims),
    }
}
fn selected_representation(v: source::SelectedRepresentation) -> TwitterSelectedRepresentation {
    TwitterSelectedRepresentation {
        url: v.url,
        claims: v.claims.map(media_claims),
    }
}
fn remote_preview(v: source::RemotePreview) -> TwitterRemotePreview {
    TwitterRemotePreview {
        url: v.url,
        description: v.description,
        claims: v.claims.map(media_claims),
    }
}
fn capture_portion(v: source::CapturePortion) -> TwitterCapturePortion {
    match v {
        source::CapturePortion::PostText => TwitterCapturePortion::PostText,
        source::CapturePortion::Author => TwitterCapturePortion::Author,
        source::CapturePortion::PublicationTime => TwitterCapturePortion::PublicationTime,
        source::CapturePortion::Hashtags => TwitterCapturePortion::Hashtags,
        source::CapturePortion::References => TwitterCapturePortion::References,
        source::CapturePortion::MediaOccurrence => TwitterCapturePortion::MediaOccurrence,
        source::CapturePortion::SelectedRepresentation => {
            TwitterCapturePortion::SelectedRepresentation
        }
        source::CapturePortion::RemotePreview => TwitterCapturePortion::RemotePreview,
    }
}
fn capture_issue(v: source::CaptureIssue) -> TwitterCaptureIssue {
    TwitterCaptureIssue {
        portion: capture_portion(v.portion),
        code: v.code,
        message: v.message,
    }
}

pub(crate) fn failure(e: source::TwitterError) -> TwitterFailure {
    use source::TwitterError as E;
    match e {
        E::Core(e) => TwitterFailure::Core {
            error: core::core_failure(&e),
        },
        E::File(e) => TwitterFailure::File {
            diagnostic: file::diagnostic(&e),
        },
        E::Store(e) => TwitterFailure::Store {
            diagnostic: store::diagnostic(&e),
        },
        E::MissingRecord(id) => TwitterFailure::MissingRecord {
            component_id: id.to_string(),
        },
        E::Corrupt(message) => TwitterFailure::Corrupt { message },
        E::PayloadVersion(version) => TwitterFailure::PayloadVersion { version },
        e => TwitterFailure::Other {
            message: e.to_string(),
        },
    }
}
pub(crate) fn view(v: source::TwitterView) -> TwitterView {
    TwitterView {
        record: TwitterRecord {
            component_id: v.record.id.to_string(),
            kind_id: source::TWITTER_KIND.to_string(),
            revision: v.record.revision.to_string(),
            basis: v.record.basis.map(|v| v.to_string()),
            snapshot: twitter_snapshot(v.record.snapshot),
        },
        applicability: match v.applicability {
            source::TwitterApplicability::Unmounted => TwitterApplicability::Unmounted,
            source::TwitterApplicability::Error(e) => {
                TwitterApplicability::Error { error: failure(e) }
            }
            source::TwitterApplicability::Input {
                host,
                comparison,
                file_error,
            } => TwitterApplicability::Input {
                host: host.to_string(),
                file_error: file_error.map(|e| file::diagnostic(&e)),
                comparison: match comparison {
                    locus_file::api::InputComparison::Matching(id) => TwitterComparison::Matching {
                        file_id: id.to_string(),
                    },
                    locus_file::api::InputComparison::Changed { basis, current } => {
                        TwitterComparison::Changed {
                            basis: basis.to_string(),
                            current: current.to_string(),
                        }
                    }
                    locus_file::api::InputComparison::Incomplete { basis, current } => {
                        TwitterComparison::Incomplete {
                            basis: basis.map(|v| v.to_string()),
                            current: file::current(current),
                        }
                    }
                },
            },
        },
    }
}
