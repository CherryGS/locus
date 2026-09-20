//! Explicit application consumer for local Media interpretation and previews.
#[path = "storage/mod.rs"]
mod storage;
use anyhow::{Context, bail};
use locus_core::api::Membership;
use locus_file::api::FILE_KIND;
use locus_media::api::{MediaKind, Rendition};
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
    let ApplicationStorage {
        mut session,
        kernel,
        files,
        media: media_service,
        twitter: _twitter,
    } = ApplicationStorage::open(configured_root()?).await?;
    let entity = kernel.create_entity(&mut session).await?;
    let file = files
        .admit(&kernel, &mut session, &path)
        .await
        .context("copy and admit File")?;
    println!("File admitted: {file:?}");
    kernel
        .attach(
            &mut session,
            Membership {
                entity,
                kind: FILE_KIND,
                component: file.id.component(),
            },
        )
        .await?;
    let media = media_service.create(&kernel, &mut session, kind).await?;
    kernel
        .attach(
            &mut session,
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
        media_service
            .interpret(&kernel, &files, &mut session, media)
            .await?
    );
    match media_service
        .preview(
            &kernel,
            &files,
            &mut session,
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
