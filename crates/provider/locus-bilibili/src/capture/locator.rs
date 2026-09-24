use super::validation::{MAX_URL_BYTES, ValidationError, invalid};
use url::Url;

pub(super) fn bvid(value: &str) -> Result<(), ValidationError> {
    if value.len() != 12
        || !value.starts_with("BV")
        || !value.as_bytes()[2..].iter().all(u8::is_ascii_alphanumeric)
    {
        return Err(invalid(
            "bvid",
            "expected BV followed by ten ASCII letters or digits",
        ));
    }
    Ok(())
}

pub(super) fn subject(snapshot: &super::types::BilibiliSnapshot) -> Result<(), ValidationError> {
    if snapshot.bvid.is_none() && snapshot.aid.is_none() && snapshot.page_url.is_none() {
        return Err(invalid(
            "subject",
            "a BVID, AID or ordinary-video page URL is required",
        ));
    }
    if let Some(id) = &snapshot.bvid {
        bvid(id)?;
    }
    if let Some(id) = &snapshot.aid {
        identifier(id, "aid")?;
    }
    let Some(page) = &snapshot.page_url else {
        return Ok(());
    };
    let url = web_url(page, "page_url")?;
    if !matches!(
        url.host_str(),
        Some("bilibili.com" | "www.bilibili.com" | "m.bilibili.com")
    ) || url.port().is_some()
    {
        return Err(invalid(
            "page_url",
            "expected a Bilibili ordinary-video page",
        ));
    }
    let path = url.path().trim_end_matches('/');
    let Some(id) = path.strip_prefix("/video/") else {
        return Err(invalid("page_url", "expected /video/BV... or /video/av..."));
    };
    if id.starts_with("BV") {
        bvid(id)?;
        if snapshot.bvid.as_deref().is_some_and(|bvid| bvid != id) {
            return Err(invalid(
                "page_url",
                "BVID disagrees with the supplied subject",
            ));
        }
    } else if let Some(aid) = id.strip_prefix("av") {
        identifier(aid, "page_url.aid")?;
        if snapshot.aid.as_deref().is_some_and(|id| id != aid) {
            return Err(invalid(
                "page_url",
                "AID disagrees with the supplied subject",
            ));
        }
    } else {
        return Err(invalid("page_url", "unrecognized ordinary-video locator"));
    }
    let mut part_index = None;
    for (_, value) in url.query_pairs().filter(|(key, _)| key == "p") {
        if part_index.is_some()
            || !value.bytes().all(|b| b.is_ascii_digit())
            || !value.parse::<u32>().is_ok_and(|index| index > 0)
        {
            return Err(invalid("page_url.p", "expected one positive part index"));
        }
        part_index = value.parse::<u32>().ok();
    }
    if let (Some(page), Some(observed)) = (part_index, snapshot.part.as_ref().and_then(|p| p.index))
        && page != observed
    {
        return Err(invalid(
            "part.index",
            "part index disagrees with the page URL",
        ));
    }
    // No AID/BVID conversion, CID inference, default part, or remote resolution.
    Ok(())
}

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
