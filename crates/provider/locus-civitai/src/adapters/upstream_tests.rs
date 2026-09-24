use super::{LiveUpstream, Upstream};
use crate::{error::CivitaiError, snapshot::PreviewImage};
use std::{sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    task::JoinHandle,
};
use tokio_rustls::{
    TlsAcceptor,
    rustls::{ServerConfig, pki_types::PrivatePkcs8KeyDer},
};

// Self-signed fixture credentials, trusted only by the injected test client.
// Production TLS validation and provider URL validation stay enabled.
const CERT: &[u8] = include_bytes!("../../tests/fixtures/preview-cert.der");
const KEY: &[u8] = include_bytes!("../../tests/fixtures/preview-key.der");
const PATH: &str = "/preview/anim=true,width=64/example.jpeg?value=kept";

fn preview(kind: Option<&str>) -> PreviewImage {
    let upstream: provider_civitai::model::PreviewMedia =
        serde_json::from_value(serde_json::json!({
            "id": 7,
            "url": format!("https://image.civitai.com{PATH}"),
            "type": kind,
            "width": 64,
            "height": 40,
            "providerExtra": {"kept": true}
        }))
        .unwrap();
    let converted: PreviewImage = upstream.into();
    assert_eq!(converted.kind.as_deref(), kind);
    assert_eq!(converted.extra["providerExtra"]["kept"], true);
    converted
}

async fn response(
    status: &str,
    content_type: &str,
    body: &[u8],
    length: usize,
) -> (LiveUpstream, JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(
            vec![CERT.to_vec().into()],
            PrivatePkcs8KeyDer::from(KEY.to_vec()).into(),
        )
        .unwrap();
    let acceptor = TlsAcceptor::from(Arc::new(config));
    let mut reply = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n"
    )
    .into_bytes();
    reply.extend_from_slice(body);
    let capture = tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        let mut stream = acceptor.accept(socket).await.unwrap();
        let mut request = Vec::new();
        while !request.windows(4).any(|v| v == b"\r\n\r\n") {
            let mut buffer = [0; 1024];
            let count = stream.read(&mut buffer).await.unwrap();
            assert!(count > 0 && request.len() < 8192);
            request.extend_from_slice(&buffer[..count]);
        }
        stream.write_all(&reply).await.unwrap();
        let _ = stream.shutdown().await;
        String::from_utf8(request).unwrap()
    });
    let client = reqwest::Client::builder()
        .no_proxy()
        .resolve("image.civitai.com", address)
        .tls_certs_only([reqwest::Certificate::from_der(CERT).unwrap()])
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    (LiveUpstream { client }, capture)
}

async fn request(capture: JoinHandle<String>) -> String {
    tokio::time::timeout(Duration::from_secs(5), capture)
        .await
        .unwrap()
        .unwrap()
        .to_ascii_lowercase()
}

#[tokio::test]
async fn downloads_declared_images_and_videos_through_the_provider() {
    for (kind, content_type, accept) in [
        (Some("video"), "video/mp4", "video/*"),
        (Some("VIDEO"), "video/webm", "video/*"),
        (Some("image"), "image/png", "image/*"),
        (Some("IMAGE"), "image/webp", "image/*"),
        (None, "image/png", "image/*"),
    ] {
        let bytes = [0, 1, 0, 255];
        let (upstream, capture) = response("200 OK", content_type, &bytes, bytes.len()).await;
        let acquired = upstream.example(&preview(kind)).await.unwrap();
        assert_eq!(acquired.bytes, bytes);
        assert_eq!(acquired.content_type, content_type);
        let request = request(capture).await;
        assert!(request.starts_with(&format!("get {PATH} http/1.1\r\n")));
        assert!(request.contains(&format!("\r\naccept: {accept}\r\n")));
    }
}

#[tokio::test]
async fn video_posters_http_failures_and_truncated_downloads_stay_failed() {
    for (status, content_type, length, problem) in [
        ("200 OK", "image/png", 4, "not a video"),
        ("404 Not Found", "video/mp4", 4, "404"),
        ("200 OK", "video/mp4", 100, "body read failed"),
    ] {
        let (upstream, capture) = response(status, content_type, &[0, 1, 0, 255], length).await;
        let result = upstream.example(&preview(Some("video"))).await;
        assert!(
            matches!(result, Err(CivitaiError::Acquisition(ref error)) if error.contains(problem))
        );
        let request = request(capture).await;
        assert!(request.contains("\r\naccept: video/*\r\n"));
    }
}

#[tokio::test]
async fn unsupported_media_kind_is_rejected_before_acquisition() {
    let upstream = LiveUpstream::new().unwrap();
    let mut preview = preview(Some("audio"));
    preview.url = "not a URL".into();
    let result = upstream.example(&preview).await;
    assert!(
        matches!(result, Err(CivitaiError::Acquisition(ref error)) if error.contains("Unsupported Civitai example media type: audio"))
    );
}
