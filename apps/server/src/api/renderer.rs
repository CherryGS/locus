//! The host may expose one trusted build output. The library is never a web root.
use crate::runtime::Shared;
use anyhow::{Context, bail};
use axum::{
    Router,
    body::Body,
    extract::Path,
    http::{HeaderValue, StatusCode, header},
    response::Response,
    routing::get,
};
use std::{
    path::{Component, PathBuf},
    sync::Arc,
};

const CSP: &str = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

pub(super) async fn attach(
    router: Router<Arc<Shared>>,
    root: Option<PathBuf>,
) -> anyhow::Result<Router<Arc<Shared>>> {
    let Some(root) = root else { return Ok(router) };
    if !root.is_absolute() {
        bail!("renderer_root must be absolute");
    }
    let root = Arc::new(
        tokio::fs::canonicalize(root)
            .await
            .context("open renderer build directory")?,
    );
    if !tokio::fs::metadata(root.join("index.html"))
        .await
        .context("open built renderer index")?
        .is_file()
    {
        bail!("renderer index is not a file");
    }
    let index = root.clone();
    let assets = root.clone();
    Ok(router
        .route(
            "/",
            get(move || serve(index.clone(), "index.html".into(), true)),
        )
        .route(
            "/index.html",
            get(move || serve(root.clone(), "index.html".into(), true)),
        )
        .route(
            "/assets/{*path}",
            get(move |Path(path): Path<String>| {
                serve(assets.clone(), format!("assets/{path}"), false)
            }),
        ))
}

async fn serve(root: Arc<PathBuf>, relative: String, index: bool) -> Response {
    let path = std::path::Path::new(&relative);
    if relative.contains('\\')
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return response(StatusCode::NOT_FOUND, "text/plain", Vec::new());
    }
    let mime = if index {
        "text/html; charset=utf-8"
    } else {
        match path.extension().and_then(|s| s.to_str()) {
            Some("js") => "text/javascript; charset=utf-8",
            Some("css") => "text/css; charset=utf-8",
            Some("woff2") => "font/woff2",
            Some("woff") => "font/woff",
            Some("png") => "image/png",
            Some("jpg" | "jpeg") => "image/jpeg",
            Some("webp") => "image/webp",
            Some("svg") => "image/svg+xml",
            Some("ico") => "image/x-icon",
            _ => return response(StatusCode::NOT_FOUND, "text/plain", Vec::new()),
        }
    };
    // Canonicalization also excludes a build-directory symlink to library data.
    let Ok(target) = tokio::fs::canonicalize(root.join(path)).await else {
        return response(StatusCode::NOT_FOUND, "text/plain", Vec::new());
    };
    if !target.starts_with(root.as_path()) {
        return response(StatusCode::NOT_FOUND, "text/plain", Vec::new());
    }
    match tokio::fs::read(target).await {
        Ok(bytes) => response(StatusCode::OK, mime, bytes),
        Err(_) => response(StatusCode::NOT_FOUND, "text/plain", Vec::new()),
    }
}

fn response(status: StatusCode, mime: &'static str, bytes: Vec<u8>) -> Response {
    let length = bytes.len();
    let mut response = Response::new(Body::from(bytes));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(mime));
    headers.insert(header::CONTENT_LENGTH, HeaderValue::from(length));
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(CSP),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    response
}
