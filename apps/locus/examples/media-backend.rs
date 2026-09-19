//! Explicit, app-owned backend consumer. Native startup remains a fixture shell.
#[path = "../src/storage.rs"]
mod storage;
use anyhow::{Context, bail};
use locus_core::Membership;
use locus_file::FILE_KIND;
use locus_media::{MediaKind, Rendition};
use storage::{ApplicationStorage, configured_root};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut args = std::env::args_os().skip(1);
    let kind = match args.next().and_then(|v| v.into_string().ok()).as_deref() {
        Some("image") => MediaKind::Image,
        Some("video") => MediaKind::Video,
        _ => bail!("usage: media-backend image|video LOCAL_PATH"),
    };
    let path = args.next().context("supply a local input path")?;
    if args.next().is_some() {
        bail!("unexpected extra arguments");
    }
    let mut app = ApplicationStorage::open(configured_root()?).await?;
    let entity = app.kernel.create_entity(&mut app.session).await?;
    let file = app
        .files
        .admit(&app.kernel, &mut app.session, &path)
        .await
        .context("copy and admit File")?;
    println!("File admitted: {file:?}");
    app.kernel
        .attach(
            &mut app.session,
            Membership {
                entity,
                kind: FILE_KIND,
                component: file.id.component(),
            },
        )
        .await?;
    let media = app
        .media
        .create(&app.kernel, &mut app.session, kind)
        .await?;
    app.kernel
        .attach(
            &mut app.session,
            Membership {
                entity,
                kind: kind.kind(),
                component: media.component(),
            },
        )
        .await?;
    println!("Entity: {entity}; component: {media:?}");
    println!(
        "Interpretation: {:?}",
        app.media
            .interpret(&app.kernel, &app.files, &mut app.session, media)
            .await?
    );
    match app
        .media
        .preview(
            &app.kernel,
            &app.files,
            &mut app.session,
            media,
            Rendition { edge: 320 },
        )
        .await
    {
        Ok(preview) => println!("Preview: {preview:?}"),
        Err(error) => println!("Preview failed: {error}"),
    }
    Ok(())
}
