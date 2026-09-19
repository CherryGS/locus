//! Local provider consumer; accepts supplied observations without contacting Twitter.
#[path = "../src/storage/mod.rs"]
mod storage;

use anyhow::{Context, bail};
use locus_core::api::Membership;
use locus_file::api::FILE_KIND;
use locus_twitter::api::{TWITTER_KIND, TwitterSnapshot, WriteOutcome};
use storage::{ApplicationStorage, configured_root};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut args = std::env::args_os().skip(1);
    let locator = args
        .next()
        .context("usage: twitter-backend POST_ID_OR_URL [LOCAL_PATH]")?
        .into_string()
        .map_err(|_| anyhow::anyhow!("post locator must be valid Unicode"))?;
    let input = args.next().filter(|value| !value.is_empty());
    if args.next().is_some() {
        bail!("unexpected extra arguments");
    }
    let snapshot = if locator.bytes().all(|byte| byte.is_ascii_digit()) {
        TwitterSnapshot {
            post_id: Some(locator),
            ..Default::default()
        }
    } else {
        TwitterSnapshot {
            page_url: Some(locator),
            ..Default::default()
        }
    };
    snapshot
        .validate()
        .context("validate Twitter observation")?;
    let ApplicationStorage {
        mut session,
        kernel,
        files,
        twitter,
        media: _media,
    } = ApplicationStorage::open(configured_root()?).await?;
    let entity = kernel.create_entity(&mut session).await?;
    println!("Entity created: {entity}");
    let source = twitter
        .create(&kernel, &mut session, snapshot)
        .await
        .context("save Twitter snapshot")?;
    println!("Twitter snapshot saved: {source:?}");
    kernel
        .attach(
            &mut session,
            Membership {
                entity,
                kind: TWITTER_KIND,
                component: source.component(),
            },
        )
        .await
        .context("attach saved Twitter snapshot")?;
    println!(
        "Source view: {:?}",
        twitter.view(&kernel, &mut session, source).await?
    );
    if let Some(path) = input {
        let file = files
            .admit(&kernel, &mut session, &path)
            .await
            .context("copy/admit File; the printed Twitter snapshot remains saved")?;
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
            .await
            .context("attach admitted File; earlier saved records remain")?;
        let prepared = twitter
            .prepare_association(&kernel, &mut session, source, file.id)
            .await
            .context("prepare explicit Source/File association")?;
        let outcome = twitter.associate(&kernel, &mut session, prepared).await?;
        println!("Association: {outcome:?}");
        if !matches!(outcome, WriteOutcome::Accepted(_)) {
            bail!("association rejected; earlier saved records remain");
        }
        println!(
            "Source view: {:?}",
            twitter.view(&kernel, &mut session, source).await?
        );
    }
    Ok(())
}
