use super::dto::*;
use crate::api::{core::mapping as core, file::mapping as file, store};
use locus_bilibili::api as source;
fn bilibili_snapshot(v: source::BilibiliSnapshot) -> BilibiliSnapshot {
    BilibiliSnapshot {
        bvid: v.bvid,
        aid: v.aid,
        page_url: v.page_url,
        requested_url: v.requested_url,
        title: v.title,
        description: v.description,
        uploader: v.uploader.map(uploader_observation),
        published_at_unix_ms: v.published_at_unix_ms.map(|v| v.to_string()),
        observed_at_unix_ms: v.observed_at_unix_ms.map(|v| v.to_string()),
        part: v.part.map(part_observation),
        asset_role: v.asset_role.map(asset_role),
        capture_local_id: v.capture_local_id,
        representation: v.representation.map(selected_representation),
        preview: v.preview.map(remote_preview),
        issues: v.issues.map(|v| v.into_iter().map(capture_issue).collect()),
    }
}
fn uploader_observation(v: source::UploaderObservation) -> BilibiliUploaderObservation {
    BilibiliUploaderObservation {
        user_id: v.user_id,
        display_name: v.display_name,
        profile_url: v.profile_url,
    }
}
fn part_observation(v: source::PartObservation) -> BilibiliPartObservation {
    BilibiliPartObservation {
        cid: v.cid,
        index: v.index,
        title: v.title,
        duration_ms: v.duration_ms.map(|v| v.to_string()),
    }
}
fn asset_role(v: source::AssetRole) -> BilibiliAssetRole {
    match v {
        source::AssetRole::Video => BilibiliAssetRole::Video,
        source::AssetRole::Cover => BilibiliAssetRole::Cover,
    }
}
fn media_claims(v: source::MediaClaims) -> BilibiliMediaClaims {
    BilibiliMediaClaims {
        width: v.width,
        height: v.height,
        duration_ms: v.duration_ms.map(|v| v.to_string()),
        mime_type: v.mime_type,
        bitrate_bps: v.bitrate_bps.map(|v| v.to_string()),
        quality: v.quality,
        container: v.container,
        video_codec: v.video_codec,
        audio_codec: v.audio_codec,
        audio_present: v.audio_present,
    }
}
fn selected_representation(v: source::SelectedRepresentation) -> BilibiliSelectedRepresentation {
    BilibiliSelectedRepresentation {
        url: v.url,
        source_urls: v.source_urls,
        assembled: v.assembled,
        claims: v.claims.map(media_claims),
    }
}
fn remote_preview(v: source::RemotePreview) -> BilibiliRemotePreview {
    BilibiliRemotePreview {
        url: v.url,
        description: v.description,
        claims: v.claims.map(media_claims),
    }
}
fn capture_portion(v: source::CapturePortion) -> BilibiliCapturePortion {
    match v {
        source::CapturePortion::Title => BilibiliCapturePortion::Title,
        source::CapturePortion::Description => BilibiliCapturePortion::Description,
        source::CapturePortion::Uploader => BilibiliCapturePortion::Uploader,
        source::CapturePortion::Part => BilibiliCapturePortion::Part,
        source::CapturePortion::PublicationTime => BilibiliCapturePortion::PublicationTime,
        source::CapturePortion::SelectedRepresentation => {
            BilibiliCapturePortion::SelectedRepresentation
        }
        source::CapturePortion::RemoteCover => BilibiliCapturePortion::RemoteCover,
    }
}
fn capture_issue(v: source::CaptureIssue) -> BilibiliCaptureIssue {
    BilibiliCaptureIssue {
        portion: capture_portion(v.portion),
        code: v.code,
        message: v.message,
    }
}
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
            snapshot: bilibili_snapshot(v.record.snapshot),
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
