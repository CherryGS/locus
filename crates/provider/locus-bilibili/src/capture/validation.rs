use super::{locator, types::*};
use thiserror::Error;

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
fn text(value: &str, field: &str) -> Result<(), ValidationError> {
    if value.contains('\0') {
        return Err(invalid(field, "text contains NUL"));
    }
    Ok(())
}
fn optional_text(value: &Option<String>, field: &str) -> Result<(), ValidationError> {
    if let Some(value) = value {
        text(value, field)?;
    }
    Ok(())
}
fn optional_url(value: &Option<String>, field: &str) -> Result<(), ValidationError> {
    if let Some(value) = value {
        locator::web_url(value, field)?;
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
        optional_text(&value.quality, field)?;
        if let Some(mime) = &value.mime_type {
            let token = |part: &str| {
                !part.is_empty()
                    && part
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
            };
            if !mime
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
    /// Local validation performs no network requests, byte access or inference.
    /// Times must be nonnegative Unix milliseconds through 9999-12-31 UTC.
    pub fn validate(&self) -> Result<(), ValidationError> {
        locator::subject(
            self.bvid.as_deref(),
            self.aid.as_deref(),
            self.page_url.as_deref(),
        )?;
        optional_url(&self.requested_url, "requested_url")?;
        optional_text(&self.title, "title")?;
        optional_text(&self.description, "description")?;
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
            optional_text(&author.display_name, "author.display_name")?;
            optional_url(&author.profile_url, "author.profile_url")?;
        }
        if let Some(tags) = &self.tags {
            for tag in tags {
                text(tag, "tags")?;
                if tag.is_empty() {
                    return Err(invalid("tags", "empty tag"));
                }
            }
        }
        if let Some(part) = &self.part {
            if let Some(cid) = &part.cid {
                locator::identifier(cid, "part.cid")?;
            }
            if part.number == Some(0) {
                return Err(invalid(
                    "part.number",
                    "expected positive one-based part number",
                ));
            }
            optional_text(&part.title, "part.title")?;
            claims(&part.claims, "part.claims")?;
        }
        if let Some(representation) = &self.representation {
            optional_url(&representation.url, "representation.url")?;
            claims(&representation.claims, "representation.claims")?;
        }
        if let Some(preview) = &self.preview {
            optional_url(&preview.url, "preview.url")?;
            optional_text(&preview.description, "preview.description")?;
            claims(&preview.claims, "preview.claims")?;
        }
        if let Some(issues) = &self.issues {
            for issue in issues {
                text(&issue.code, "issues.code")?;
                if issue.code.is_empty() {
                    return Err(invalid("issues.code", "empty code"));
                }
                optional_text(&issue.message, "issues.message")?;
            }
        }
        Ok(())
    }
}
