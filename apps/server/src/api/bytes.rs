use super::{
    error::{ApiError, ErrorCode},
    handlers::{canonical_id, path_id},
};
use crate::runtime::Shared;
use axum::{
    body::Body,
    extract::{Path, State, rejection::PathRejection},
    http::{Method, header},
    response::Response,
};
use std::sync::Arc;

#[utoipa::path(operation_id="read_original_bytes", get, path="/api/v1/files/{file_id}/bytes", params(("file_id"=String,Path)),responses((status=200,body=String,content_type="application/octet-stream",description="Complete original attachment. Range is ignored. Length is from the opened file."),(status=404,body=ApiError)))]
pub(super) async fn original(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
    method: Method,
) -> Result<Response, ApiError> {
    let id = path_id(path)?;
    let uuid = canonical_id(&id)?;
    let file = locus_file::api::FileId::from_bytes(uuid.as_bytes())
        .map_err(|_| ApiError::invalid("file_id must be UUIDv7"))?;
    response(state.original(file).await?, method == Method::HEAD, false)
}
#[utoipa::path(head, path="/api/v1/files/{file_id}/bytes", params(("file_id"=String,Path)),responses((status=200,description="Same representation headers as GET; no body"),(status=404,body=ApiError)))]
pub(super) async fn original_head(
    state: State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Response, ApiError> {
    original(state, path, Method::HEAD).await
}
#[utoipa::path(operation_id="read_preview_bytes", get, path="/api/v1/previews/{locator}/bytes", params(("locator"=String,Path)),responses((status=200,body=String,content_type="image/png",description="Already-produced PNG. Run-scoped locator does not pin bytes and never regenerates. Range is ignored."),(status=404,body=ApiError)))]
pub(super) async fn preview(
    State(state): State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
    method: Method,
) -> Result<Response, ApiError> {
    response(
        state.derived(path_id(path)?).await?,
        method == Method::HEAD,
        true,
    )
}
#[utoipa::path(head, path="/api/v1/previews/{locator}/bytes", params(("locator"=String,Path)),responses((status=200,description="Same representation headers as GET; no body"),(status=404,body=ApiError)))]
pub(super) async fn preview_head(
    state: State<Arc<Shared>>,
    path: Result<Path<String>, PathRejection>,
) -> Result<Response, ApiError> {
    preview(state, path, Method::HEAD).await
}
fn response(
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
