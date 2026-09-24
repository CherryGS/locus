use super::validation::{ValidationError, invalid};
use url::Url;

pub(super) fn identifier(value: &str, field: &str) -> Result<(), ValidationError> {
    if value.is_empty()
        || value.len() > 20
        || value.starts_with('0')
        || !value.bytes().all(|v| v.is_ascii_digit())
        || value.parse::<u64>().is_err()
    {
        return Err(invalid(
            field,
            "expected a positive canonical decimal u64 identifier",
        ));
    }
    Ok(())
}

pub(super) fn web_url(value: &str, field: &str) -> Result<Url, ValidationError> {
    if value
        .bytes()
        .any(|v| v.is_ascii_whitespace() || v.is_ascii_control())
        || value.contains('\\')
    {
        return Err(invalid(
            field,
            "URL contains whitespace, controls or backslashes",
        ));
    }
    let bytes = value.as_bytes();
    if !value
        .get(..8)
        .is_some_and(|v| v.eq_ignore_ascii_case("https://"))
        && !value
            .get(..7)
            .is_some_and(|v| v.eq_ignore_ascii_case("http://"))
    {
        return Err(invalid(field, "expected an explicit HTTP(S) URL authority"));
    }
    for (index, byte) in bytes.iter().enumerate() {
        if *byte == b'%'
            && !bytes
                .get(index + 1..index + 3)
                .is_some_and(|v| v.iter().all(u8::is_ascii_hexdigit))
        {
            return Err(invalid(field, "invalid URL percent escape"));
        }
    }
    let url = Url::parse(value).map_err(|_| invalid(field, "expected an absolute HTTP(S) URL"))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(invalid(
            field,
            "expected an absolute HTTP(S) URL without credentials",
        ));
    }
    Ok(url)
}

/// Recognize only explicit submission pages; no network resolution or part inference.
pub(super) fn subject(
    bvid: Option<&str>,
    aid: Option<&str>,
    page: Option<&str>,
) -> Result<(), ValidationError> {
    let bv = |value: &str| {
        value.len() == 12
            && value.starts_with("BV")
            && value.bytes().all(|b| b.is_ascii_alphanumeric())
    };
    if bvid.is_some_and(|v| !bv(v)) {
        return Err(invalid(
            "bvid",
            "expected BV and ten ASCII alphanumeric characters",
        ));
    }
    if let Some(aid) = aid {
        identifier(aid, "aid")?;
    }
    if bvid.is_none() && aid.is_none() && page.is_none() {
        return Err(invalid(
            "subject",
            "submission ID or recognized page URL required",
        ));
    }
    if let Some(page) = page {
        let url = web_url(page, "page_url")?;
        if !matches!(
            url.host_str(),
            Some("www.bilibili.com" | "bilibili.com" | "m.bilibili.com")
        ) || url.port().is_some()
        {
            return Err(invalid("page_url", "unrecognized Bilibili host or port"));
        }
        let segments: Vec<_> = url.path().trim_end_matches('/').split('/').collect();
        let ["", "video", id] = segments.as_slice() else {
            return Err(invalid("page_url", "expected video submission path"));
        };
        if bv(id) {
            if bvid.is_some_and(|v| v != *id) {
                return Err(invalid("page_url", "different BVID"));
            }
        } else if let Some(n) = id.strip_prefix("av") {
            identifier(n, "page_url")?;
            if aid.is_some_and(|v| v != n) {
                return Err(invalid("page_url", "different AV identifier"));
            }
        } else {
            return Err(invalid("page_url", "unrecognized submission identifier"));
        }
        for (key, value) in url.query_pairs() {
            if key == "p"
                && (value.parse::<u32>().map_or(true, |n| n == 0)
                    || !value.bytes().all(|b| b.is_ascii_digit()))
            {
                return Err(invalid("page_url", "invalid part number"));
            }
        }
    }
    Ok(())
}
