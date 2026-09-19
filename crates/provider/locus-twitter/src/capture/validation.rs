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
        optional_text(&value.quality, MAX_LABEL_BYTES, field)?;
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

impl TwitterSnapshot {
    /// Local validation performs no network requests, byte access or inference.
    /// Times must be nonnegative Unix milliseconds through 9999-12-31 UTC.
    pub fn validate(&self) -> Result<(), ValidationError> {
        locator::subject(self.post_id.as_deref(), self.page_url.as_deref(), "subject")?;
        optional_url(&self.requested_url, "requested_url")?;
        optional_text(&self.text, MAX_TEXT_BYTES, "text")?;
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
        if let Some(author) = &self.author {
            if let Some(id) = &author.user_id {
                locator::identifier(id, "author.user_id")?;
            }
            if let Some(handle) = &author.handle {
                locator::handle(handle, "author.handle")?;
            }
            optional_text(&author.display_name, MAX_LABEL_BYTES, "author.display_name")?;
            optional_url(&author.profile_url, "author.profile_url")?;
        }
        collection(&self.hashtags, "hashtags")?;
        if let Some(tags) = &self.hashtags {
            for tag in tags {
                text(tag, MAX_LABEL_BYTES, "hashtags")?;
                if tag.is_empty() {
                    return Err(invalid("hashtags", "empty hashtag"));
                }
            }
        }
        collection(&self.references, "references")?;
        if let Some(references) = &self.references {
            for reference in references {
                if reference.post_id.is_some() || reference.page_url.is_some() {
                    locator::subject(
                        reference.post_id.as_deref(),
                        reference.page_url.as_deref(),
                        "references",
                    )?;
                }
            }
        }
        if let Some(occurrence) = &self.occurrence {
            if let Some(id) = &occurrence.media_id {
                locator::identifier(id, "occurrence.media_id")?;
            }
            optional_text(
                &occurrence.capture_local_id,
                MAX_LABEL_BYTES,
                "occurrence.capture_local_id",
            )?;
            if occurrence
                .capture_local_id
                .as_ref()
                .is_some_and(String::is_empty)
            {
                return Err(invalid("occurrence.capture_local_id", "empty identifier"));
            }
            optional_text(&occurrence.alt_text, MAX_TEXT_BYTES, "occurrence.alt_text")?;
            claims(&occurrence.claims, "occurrence.claims")?;
        }
        if let Some(representation) = &self.representation {
            optional_url(&representation.url, "representation.url")?;
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
        // Reserve enough space for version/basis so a later association never fails
        // merely because a maximally sized valid snapshot acquired its first basis.
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
