use super::dto::*;
use crate::api::error::ApiError;
use locus_bilibili::api as source;
fn number<T: std::str::FromStr>(v: Option<String>) -> Result<Option<T>, ApiError> {
    v.map(|v| {
        v.parse()
            .map_err(|_| ApiError::invalid("Invalid decimal capture value"))
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
        uploader: v.uploader.map(uploader_observation).transpose()?,
        published_at_unix_ms: number(v.published_at_unix_ms)?,
        observed_at_unix_ms: number(v.observed_at_unix_ms)?,
        part: v.part.map(part_observation).transpose()?,
        asset_role: v.asset_role.map(asset_role),
        capture_local_id: v.capture_local_id,
        representation: v.representation.map(selected_representation).transpose()?,
        preview: v.preview.map(remote_preview).transpose()?,
        issues: v
            .issues
            .map(|v| {
                v.into_iter()
                    .map(capture_issue)
                    .collect::<Result<Vec<_>, _>>()
            })
            .transpose()?,
    };
    result
        .validate()
        .map_err(|e| ApiError::invalid(e.to_string()))?;
    Ok(result)
}
fn uploader_observation(
    v: BilibiliUploaderObservation,
) -> Result<source::UploaderObservation, ApiError> {
    let result = source::UploaderObservation {
        user_id: v.user_id,
        display_name: v.display_name,
        profile_url: v.profile_url,
    };
    Ok(result)
}
fn part_observation(v: BilibiliPartObservation) -> Result<source::PartObservation, ApiError> {
    let result = source::PartObservation {
        cid: v.cid,
        index: v.index,
        title: v.title,
        duration_ms: number(v.duration_ms)?,
    };
    Ok(result)
}
fn asset_role(v: BilibiliAssetRole) -> source::AssetRole {
    match v {
        BilibiliAssetRole::Video => source::AssetRole::Video,
        BilibiliAssetRole::Cover => source::AssetRole::Cover,
    }
}
fn media_claims(v: BilibiliMediaClaims) -> Result<source::MediaClaims, ApiError> {
    let result = source::MediaClaims {
        width: v.width,
        height: v.height,
        duration_ms: number(v.duration_ms)?,
        mime_type: v.mime_type,
        bitrate_bps: number(v.bitrate_bps)?,
        quality: v.quality,
        container: v.container,
        video_codec: v.video_codec,
        audio_codec: v.audio_codec,
        audio_present: v.audio_present,
    };
    Ok(result)
}
fn selected_representation(
    v: BilibiliSelectedRepresentation,
) -> Result<source::SelectedRepresentation, ApiError> {
    let result = source::SelectedRepresentation {
        url: v.url,
        source_urls: v.source_urls,
        assembled: v.assembled,
        claims: v.claims.map(media_claims).transpose()?,
    };
    Ok(result)
}
fn remote_preview(v: BilibiliRemotePreview) -> Result<source::RemotePreview, ApiError> {
    let result = source::RemotePreview {
        url: v.url,
        description: v.description,
        claims: v.claims.map(media_claims).transpose()?,
    };
    Ok(result)
}
fn capture_portion(v: BilibiliCapturePortion) -> source::CapturePortion {
    match v {
        BilibiliCapturePortion::Title => source::CapturePortion::Title,
        BilibiliCapturePortion::Description => source::CapturePortion::Description,
        BilibiliCapturePortion::Uploader => source::CapturePortion::Uploader,
        BilibiliCapturePortion::Part => source::CapturePortion::Part,
        BilibiliCapturePortion::PublicationTime => source::CapturePortion::PublicationTime,
        BilibiliCapturePortion::SelectedRepresentation => {
            source::CapturePortion::SelectedRepresentation
        }
        BilibiliCapturePortion::RemoteCover => source::CapturePortion::RemoteCover,
    }
}
fn capture_issue(v: BilibiliCaptureIssue) -> Result<source::CaptureIssue, ApiError> {
    let result = source::CaptureIssue {
        portion: capture_portion(v.portion),
        code: v.code,
        message: v.message,
    };
    Ok(result)
}
