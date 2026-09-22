//! HTTP transfer mechanics shared by original and derived representations.
use super::error::{ApiError, ErrorCode};
use axum::{body::Body, http::header, response::Response};
pub(crate) fn response(
    opened: crate::runtime::OpenedBytes,
    head: bool,
    png: bool,
) -> Result<Response, ApiError> {
    let crate::runtime::OpenedBytes { file, length } = opened;
    let body = if head {
        Body::empty()
    } else {
        streaming(tokio::fs::File::from_std(file), length)
    };
    Response::builder()
        .header(
            header::CONTENT_TYPE,
            if png {
                "image/png"
            } else {
                "application/octet-stream"
            },
        )
        .header(header::CONTENT_LENGTH, length)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(
            header::CONTENT_DISPOSITION,
            if png { "inline" } else { "attachment" },
        )
        .body(body)
        .map_err(|e| ApiError::new(ErrorCode::OperationFailed, e.to_string()))
}
/// Original resources support one byte range. Malformed/multiple ranges and
/// If-Range fall back to the complete representation: we publish no validator
/// capable of establishing the conditional range's byte identity.
pub(crate) fn original(
    mut opened: crate::runtime::OpenedBytes,
    head: bool,
    headers: &axum::http::HeaderMap,
) -> Result<Response, ApiError> {
    use axum::http::StatusCode;
    use std::io::{Seek, SeekFrom};
    let total = opened.length;
    let range = if head
        || headers.contains_key(header::IF_RANGE)
        || headers.get_all(header::RANGE).iter().count() != 1
    {
        None
    } else {
        headers
            .get(header::RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| byte_range(v, total))
    };
    let mut response = match range {
        None => response(opened, head, false)?,
        Some(Ok((start, end))) => {
            opened
                .file
                .seek(SeekFrom::Start(start))
                .map_err(|e| ApiError::new(ErrorCode::OperationFailed, e.to_string()))?;
            opened.length = end - start + 1;
            let mut response = response(opened, false, false)?;
            *response.status_mut() = StatusCode::PARTIAL_CONTENT;
            response.headers_mut().insert(
                header::CONTENT_RANGE,
                format!("bytes {start}-{end}/{total}").parse().map_err(
                    |e: axum::http::header::InvalidHeaderValue| {
                        ApiError::new(ErrorCode::OperationFailed, e.to_string())
                    },
                )?,
            );
            response
        }
        Some(Err(())) => {
            opened.length = 0;
            let mut response = response(opened, true, false)?;
            *response.status_mut() = StatusCode::RANGE_NOT_SATISFIABLE;
            response.headers_mut().insert(
                header::CONTENT_RANGE,
                format!("bytes */{total}").parse().map_err(
                    |e: axum::http::header::InvalidHeaderValue| {
                        ApiError::new(ErrorCode::OperationFailed, e.to_string())
                    },
                )?,
            );
            response
        }
    };
    response.headers_mut().insert(
        header::ACCEPT_RANGES,
        axum::http::HeaderValue::from_static("bytes"),
    );
    Ok(response)
}

// None means ignored syntax/unit; Err means a syntactically valid but
// unsatisfiable range. Saturation handles arbitrarily large decimal numerals.
fn byte_range(value: &str, length: u64) -> Option<Result<(u64, u64), ()>> {
    let (start, end) = value.trim().strip_prefix("bytes=")?.split_once('-')?;
    fn number(value: &str) -> Option<u64> {
        if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        Some(value.bytes().fold(0_u64, |n, b| {
            n.saturating_mul(10).saturating_add(u64::from(b - b'0'))
        }))
    }
    if start.is_empty() {
        let suffix = number(end)?;
        return Some(if suffix == 0 || length == 0 {
            Err(())
        } else {
            Ok((length.saturating_sub(suffix), length - 1))
        });
    }
    let start = number(start)?;
    let end = if end.is_empty() {
        u64::MAX
    } else {
        number(end)?
    };
    if start > end {
        return None;
    }
    Some(if start >= length {
        Err(())
    } else {
        Ok((start, end.min(length - 1)))
    })
}

/// Report premature EOF as a body error as well as I/O failures. HTTP consumers
/// must never mistake a truncated representation for a successful empty file.
fn streaming<R: tokio::io::AsyncRead + Unpin + Send + 'static>(
    mut reader: R,
    mut remaining: u64,
) -> Body {
    use tokio::io::AsyncReadExt;
    let stream = async_stream::try_stream! {
        while remaining>0 {
            let mut bytes=vec![0;remaining.min(64*1024) as usize];
            let count=reader.read(&mut bytes).await?;
            if count==0 { Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof,"representation ended before Content-Length"))?; }
            remaining-=count as u64; bytes.truncate(count);
            yield bytes;
        }
    };
    fn typed<S: futures_core::Stream<Item = Result<Vec<u8>, std::io::Error>>>(s: S) -> S {
        s
    }
    Body::from_stream(typed(stream))
}
#[cfg(test)]
mod tests {
    use super::*;
    use http_body_util::BodyExt;
    #[tokio::test]
    async fn partial_transfer_is_an_error() {
        let mut body = streaming(&b"partial"[..], 20);
        assert_eq!(
            body.frame().await.unwrap().unwrap().into_data().unwrap(),
            "partial"
        );
        assert!(body.frame().await.unwrap().is_err());
    }
}
