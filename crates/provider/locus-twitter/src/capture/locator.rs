use super::validation::{MAX_URL_BYTES, ValidationError, invalid};
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

pub(super) fn handle(value: &str, field: &str) -> Result<(), ValidationError> {
    if value.is_empty()
        || value.len() > 15
        || !value
            .bytes()
            .all(|v| v.is_ascii_alphanumeric() || v == b'_')
    {
        return Err(invalid(
            field,
            "expected 1–15 ASCII letters, digits or underscores",
        ));
    }
    Ok(())
}

pub(super) fn web_url(value: &str, field: &str) -> Result<Url, ValidationError> {
    if value.len() > MAX_URL_BYTES
        || value
            .bytes()
            .any(|v| v.is_ascii_whitespace() || v.is_ascii_control())
        || value.contains('\\')
    {
        return Err(invalid(
            field,
            "URL exceeds limit or contains whitespace, controls or backslashes",
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

/// Local recognition only: x.com/twitter.com and their www/mobile/m aliases;
/// /<handle>/status/<id>, /i/web/status/<id>, /i/status/<id>, optionally followed
/// by /photo/<positive index> or /video/<positive index>. Query/fragment are retained.
pub(super) fn post_url(value: &str, field: &str) -> Result<String, ValidationError> {
    let url = web_url(value, field)?;
    if !matches!(
        url.host_str(),
        Some(
            "x.com"
                | "www.x.com"
                | "mobile.x.com"
                | "m.x.com"
                | "twitter.com"
                | "www.twitter.com"
                | "mobile.twitter.com"
                | "m.twitter.com"
        )
    ) || url.port().is_some()
    {
        return Err(invalid(field, "unrecognized Twitter post host or port"));
    }
    let segments: Vec<_> = url
        .path()
        .trim_end_matches('/')
        .split('/')
        .skip(1)
        .collect();
    let (id, suffix) = match segments.as_slice() {
        ["i", "web", "status", id, rest @ ..] => (*id, rest),
        ["i", "status", id, rest @ ..] => (*id, rest),
        [author, "status", id, rest @ ..] => {
            handle(author, field)?;
            (*id, rest)
        }
        _ => return Err(invalid(field, "unrecognized Twitter post path")),
    };
    identifier(id, field)?;
    match suffix {
        [] => (),
        ["photo" | "video", index]
            if index.parse::<u32>().is_ok_and(|n| n > 0)
                && index.bytes().all(|v| v.is_ascii_digit()) => {}
        _ => return Err(invalid(field, "unrecognized Twitter post suffix")),
    }
    Ok(id.to_owned())
}

pub(super) fn subject(
    id: Option<&str>,
    page: Option<&str>,
    field: &str,
) -> Result<(), ValidationError> {
    if let Some(id) = id {
        identifier(id, field)?;
    }
    let page_id = page.map(|v| post_url(v, field)).transpose()?;
    if id.is_none() && page_id.is_none() {
        return Err(invalid(
            field,
            "a post ID or recognized page URL is required",
        ));
    }
    if let (Some(id), Some(page_id)) = (id, page_id)
        && id != page_id
    {
        return Err(invalid(
            field,
            "post ID and page URL identify different subjects",
        ));
    }
    Ok(())
}
