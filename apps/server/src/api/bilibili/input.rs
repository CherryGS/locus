use super::dto::*;
use crate::api::error::ApiError;
use locus_bilibili::api as source;
fn number<T: std::str::FromStr>(v: Option<String>) -> Result<Option<T>, ApiError> {
    v.map(|v| {
        v.parse()
            .map_err(|_| ApiError::invalid("Invalid decimal Bilibili value"))
    })
    .transpose()
}
pub(crate) fn snapshot(v: BilibiliSnapshot) -> Result<source::BilibiliSnapshot, ApiError> {
    let result = source::BilibiliSnapshot {
        bvid: v.bvid,
        aid: v.aid,
        page_url: v.page_url,
        requested_url: v.requested_url,
        title: v.title,
        description: v.description,
        author: v.author.map(author).transpose()?,
        published_at_unix_ms: number(v.published_at_unix_ms)?,
        observed_at_unix_ms: number(v.observed_at_unix_ms)?,
        tags: v.tags,
        part: v.part.map(part).transpose()?,
        representation: v.representation.map(representation).transpose()?,
        preview: v.preview.map(preview).transpose()?,
        issues: v
            .issues
            .map(|v| v.into_iter().map(issue).collect())
            .transpose()?,
    };
    result
        .validate()
        .map_err(|e| ApiError::invalid(e.to_string()))?;
    Ok(result)
}
pub(crate) fn author(v: BilibiliAuthorObservation) -> Result<source::AuthorObservation, ApiError> {
    let result = source::AuthorObservation {
        user_id: v.user_id,
        display_name: v.display_name,
        profile_url: v.profile_url,
    };
    Ok(result)
}
pub(crate) fn part(v: BilibiliPartObservation) -> Result<source::PartObservation, ApiError> {
    let result = source::PartObservation {
        cid: v.cid,
        number: v.number,
        title: v.title,
        claims: v.claims.map(claims).transpose()?,
    };
    Ok(result)
}
pub(crate) fn claims(v: BilibiliMediaClaims) -> Result<source::MediaClaims, ApiError> {
    let result = source::MediaClaims {
        width: v.width,
        height: v.height,
        duration_ms: number(v.duration_ms)?,
        mime_type: v.mime_type,
        bitrate_bps: number(v.bitrate_bps)?,
        quality: v.quality,
    };
    Ok(result)
}
pub(crate) fn representation(
    v: BilibiliSelectedRepresentation,
) -> Result<source::SelectedRepresentation, ApiError> {
    let result = source::SelectedRepresentation {
        url: v.url,
        claims: v.claims.map(claims).transpose()?,
    };
    Ok(result)
}
pub(crate) fn preview(v: BilibiliRemotePreview) -> Result<source::RemotePreview, ApiError> {
    let result = source::RemotePreview {
        url: v.url,
        description: v.description,
        claims: v.claims.map(claims).transpose()?,
    };
    Ok(result)
}
pub(crate) fn issue(v: BilibiliCaptureIssue) -> Result<source::CaptureIssue, ApiError> {
    let result = source::CaptureIssue {
        portion: match v.portion {
            BilibiliCapturePortion::Submission => source::CapturePortion::Submission,
            BilibiliCapturePortion::Author => source::CapturePortion::Author,
            BilibiliCapturePortion::PublicationTime => source::CapturePortion::PublicationTime,
            BilibiliCapturePortion::Tags => source::CapturePortion::Tags,
            BilibiliCapturePortion::Part => source::CapturePortion::Part,
            BilibiliCapturePortion::SelectedRepresentation => {
                source::CapturePortion::SelectedRepresentation
            }
            BilibiliCapturePortion::RemotePreview => source::CapturePortion::RemotePreview,
        },
        code: v.code,
        message: v.message,
    };
    Ok(result)
}
