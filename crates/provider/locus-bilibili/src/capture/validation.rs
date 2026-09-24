use super::{locator, types::*};
use thiserror::Error;

/// UTF-8 byte budgets; exceeding a budget rejects without truncating observations.
pub const MAX_TEXT_BYTES: usize = 65_536;
pub const MAX_LABEL_BYTES: usize = 1_024;
pub const MAX_URL_BYTES: usize = 8_192;
pub const MAX_COLLECTION_ITEMS: usize = 128;
/// Bounds the complete serialized versioned persisted payload, including basis.
pub const MAX_PAYLOAD_BYTES: usize = 262_144;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("{field}: {reason}")]
pub struct ValidationError {
    pub field: String,
    pub reason: String,
}
pub(super) fn invalid(field: &str, reason: &str) -> ValidationError {
    ValidationError {
        field: field.into(),
        reason: reason.into(),
    }
}
fn text(value: &str, limit: usize, field: &str) -> Result<(), ValidationError> {
    if value.len() > limit || value.contains('\0') {
        return Err(invalid(field, "text exceeds byte budget or contains NUL"));
    }
    Ok(())
}
fn optional_text(value: &Option<String>, limit: usize, field: &str) -> Result<(), ValidationError> {
    if let Some(value) = value {
        text(value, limit, field)?;
    }
    Ok(())
}
fn optional_url(value: &Option<String>, field: &str) -> Result<(), ValidationError> {
    if let Some(value) = value {
        locator::web_url(value, field)?;
    }
    Ok(())
}
fn collection<T>(value: &Option<Vec<T>>, field: &str) -> Result<(), ValidationError> {
    if value
        .as_ref()
        .is_some_and(|v| v.len() > MAX_COLLECTION_ITEMS)
    {
        return Err(invalid(field, "collection exceeds 128 entries"));
    }
    Ok(())
}
fn claims(value: &Option<MediaClaims>, field: &str) -> Result<(), ValidationError> {
    if let Some(value) = value {
        if value.width == Some(0)
            || value.height == Some(0)
            || value.bitrate_bps == Some(0)
            || value.duration_ms.is_some_and(|v| v > i64::MAX as u64)
            || value.bitrate_bps.is_some_and(|v| v > i64::MAX as u64)
        {
            return Err(invalid(
                field,
                "dimensions/bitrate must be positive; duration/bitrate must fit i64",
            ));
        }
        for label in [
            &value.quality,
            &value.container,
            &value.video_codec,
            &value.audio_codec,
        ] {
            optional_text(label, MAX_LABEL_BYTES, field)?;
        }
        if let Some(mime) = &value.mime_type {
            let token = |part: &str| {
                !part.is_empty()
                    && part
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
            };
            if mime.len() > 255
                || !mime
                    .split_once('/')
                    .is_some_and(|(a, b)| token(a) && token(b))
            {
                return Err(invalid(
                    field,
                    "expected a MIME type/subtype without parameters",
                ));
            }
        }
    }
    Ok(())
}

impl BilibiliSnapshot {
    /// Validate submitted claims locally without resolving URLs or reading bytes.
    pub fn validate(&self) -> Result<(), ValidationError> {
        locator::subject(self)?;
        optional_url(&self.requested_url, "requested_url")?;
        optional_text(&self.title, MAX_TEXT_BYTES, "title")?;
        optional_text(&self.description, MAX_TEXT_BYTES, "description")?;
        optional_text(&self.capture_local_id, MAX_LABEL_BYTES, "capture_local_id")?;
        if self.capture_local_id.as_ref().is_some_and(String::is_empty) {
            return Err(invalid("capture_local_id", "empty identifier"));
        }
        for (field, time) in [
            ("published_at_unix_ms", self.published_at_unix_ms),
            ("observed_at_unix_ms", self.observed_at_unix_ms),
        ] {
            if time.is_some_and(|v| !(0..=253_402_300_799_999).contains(&v)) {
                return Err(invalid(
                    field,
                    "time outside supported Unix millisecond range",
                ));
            }
        }
        if let Some(uploader) = &self.uploader {
            if let Some(id) = &uploader.user_id {
                locator::identifier(id, "uploader.user_id")?;
            }
            optional_text(
                &uploader.display_name,
                MAX_LABEL_BYTES,
                "uploader.display_name",
            )?;
            optional_url(&uploader.profile_url, "uploader.profile_url")?;
        }
        if let Some(part) = &self.part {
            if let Some(cid) = &part.cid {
                locator::identifier(cid, "part.cid")?;
            }
            if part.index == Some(0) || part.duration_ms.is_some_and(|v| v > i64::MAX as u64) {
                return Err(invalid(
                    "part",
                    "index must be positive and duration must fit i64",
                ));
            }
            optional_text(&part.title, MAX_TEXT_BYTES, "part.title")?;
        }
        if let Some(representation) = &self.representation {
            optional_url(&representation.url, "representation.url")?;
            collection(&representation.source_urls, "representation.source_urls")?;
            if let Some(urls) = &representation.source_urls {
                for url in urls {
                    locator::web_url(url, "representation.source_urls")?;
                }
            }
            claims(&representation.claims, "representation.claims")?;
        }
        if let Some(preview) = &self.preview {
            optional_url(&preview.url, "preview.url")?;
            optional_text(&preview.description, MAX_TEXT_BYTES, "preview.description")?;
            claims(&preview.claims, "preview.claims")?;
        }
        collection(&self.issues, "issues")?;
        if let Some(issues) = &self.issues {
            for issue in issues {
                text(&issue.code, MAX_LABEL_BYTES, "issues.code")?;
                if issue.code.is_empty() {
                    return Err(invalid("issues.code", "empty code"));
                }
                optional_text(&issue.message, MAX_TEXT_BYTES, "issues.message")?;
            }
        }
        let bytes = serde_json::to_vec(self).map_err(|e| invalid("snapshot", &e.to_string()))?;
        if bytes.len() > MAX_PAYLOAD_BYTES - 256 {
            return Err(invalid(
                "snapshot",
                "serialized payload exceeds byte budget",
            ));
        }
        Ok(())
    }
}
