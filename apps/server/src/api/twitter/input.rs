use super::dto::*;
use crate::api::error::ApiError;
use locus_twitter::api as source;
fn number<T: std::str::FromStr>(v: Option<String>) -> Result<Option<T>, ApiError> {
    v.map(|v| {
        v.parse()
            .map_err(|_| ApiError::invalid("Invalid decimal capture value"))
    })
    .transpose()
}
pub(crate) fn snapshot(v: TwitterSnapshot) -> Result<source::TwitterSnapshot, ApiError> {
    let snapshot = source::TwitterSnapshot {
        post_id: v.post_id,
        page_url: v.page_url,
        requested_url: v.requested_url,
        text: v.text,
        author: v.author.map(author_observation),
        published_at_unix_ms: number(v.published_at_unix_ms)?,
        observed_at_unix_ms: number(v.observed_at_unix_ms)?,
        hashtags: v.hashtags,
        references: v
            .references
            .map(|v| v.into_iter().map(provider_reference).collect()),
        occurrence: v.occurrence.map(media_occurrence).transpose()?,
        representation: v.representation.map(selected_representation).transpose()?,
        preview: v.preview.map(remote_preview).transpose()?,
        issues: v.issues.map(|v| v.into_iter().map(capture_issue).collect()),
    };
    snapshot
        .validate()
        .map_err(|e| ApiError::invalid(e.to_string()))?;
    Ok(snapshot)
}

fn author_observation(v: TwitterAuthorObservation) -> source::AuthorObservation {
    source::AuthorObservation {
        user_id: v.user_id,
        handle: v.handle,
        display_name: v.display_name,
        profile_url: v.profile_url,
    }
}
fn reference_kind(v: TwitterReferenceKind) -> source::ReferenceKind {
    match v {
        TwitterReferenceKind::ReplyTo => source::ReferenceKind::ReplyTo,
        TwitterReferenceKind::Quote => source::ReferenceKind::Quote,
        TwitterReferenceKind::Repost => source::ReferenceKind::Repost,
    }
}
fn provider_reference(v: TwitterProviderReference) -> source::ProviderReference {
    source::ProviderReference {
        kind: reference_kind(v.kind),
        post_id: v.post_id,
        page_url: v.page_url,
    }
}
fn media_label(v: TwitterMediaLabel) -> source::MediaLabel {
    match v {
        TwitterMediaLabel::Photo => source::MediaLabel::Photo,
        TwitterMediaLabel::Video => source::MediaLabel::Video,
        TwitterMediaLabel::AnimatedImage => source::MediaLabel::AnimatedImage,
    }
}
fn media_claims(v: TwitterMediaClaims) -> Result<source::MediaClaims, ApiError> {
    Ok(source::MediaClaims {
        width: v.width,
        height: v.height,
        duration_ms: number(v.duration_ms)?,
        mime_type: v.mime_type,
        bitrate_bps: number(v.bitrate_bps)?,
        quality: v.quality,
    })
}
fn media_occurrence(v: TwitterMediaOccurrence) -> Result<source::MediaOccurrence, ApiError> {
    Ok(source::MediaOccurrence {
        media_id: v.media_id,
        capture_local_id: v.capture_local_id,
        source_order: v.source_order,
        label: v.label.map(media_label),
        alt_text: v.alt_text,
        claims: v.claims.map(media_claims).transpose()?,
    })
}
fn selected_representation(
    v: TwitterSelectedRepresentation,
) -> Result<source::SelectedRepresentation, ApiError> {
    Ok(source::SelectedRepresentation {
        url: v.url,
        claims: v.claims.map(media_claims).transpose()?,
    })
}
fn remote_preview(v: TwitterRemotePreview) -> Result<source::RemotePreview, ApiError> {
    Ok(source::RemotePreview {
        url: v.url,
        description: v.description,
        claims: v.claims.map(media_claims).transpose()?,
    })
}
fn capture_portion(v: TwitterCapturePortion) -> source::CapturePortion {
    match v {
        TwitterCapturePortion::PostText => source::CapturePortion::PostText,
        TwitterCapturePortion::Author => source::CapturePortion::Author,
        TwitterCapturePortion::PublicationTime => source::CapturePortion::PublicationTime,
        TwitterCapturePortion::Hashtags => source::CapturePortion::Hashtags,
        TwitterCapturePortion::References => source::CapturePortion::References,
        TwitterCapturePortion::MediaOccurrence => source::CapturePortion::MediaOccurrence,
        TwitterCapturePortion::SelectedRepresentation => {
            source::CapturePortion::SelectedRepresentation
        }
        TwitterCapturePortion::RemotePreview => source::CapturePortion::RemotePreview,
    }
}
fn capture_issue(v: TwitterCaptureIssue) -> source::CaptureIssue {
    source::CaptureIssue {
        portion: capture_portion(v.portion),
        code: v.code,
        message: v.message,
    }
}
