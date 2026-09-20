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
