//! Offline, explicitly owned verification library. Never used by production routes.
use anyhow::{Context, bail};
use locus_core::api::Membership;
use locus_file::api::FILE_KIND;
use locus_twitter::api::*;
use serde_json::{Value, json};
use std::path::Path;
#[path = "../storage/application.rs"]
mod storage;

pub async fn seed(root: &Path, video: Option<&Path>) -> anyhow::Result<Value> {
    if !root.is_absolute() || root.join("metadata.sqlite").exists() {
        bail!("fixture requires an absolute new library root without metadata.sqlite");
    }
    let mut db = storage::ApplicationStorage::open(root).await?;
    let input = root.join("fixture-input.png");
    image::RgbImage::from_pixel(64, 40, image::Rgb([35, 90, 120])).save(&input)?;
    let mut entries = Vec::new();
    for (index, name) in [
        "complete",
        "partial-empty",
        "locator-only",
        "changed-association",
        "producer-issue",
        "corrupt",
        "missing-record",
        "matching-file-error",
        "missing-input",
        "unmounted",
        "future-version",
    ]
    .into_iter()
    .enumerate()
    {
        let entity = db.kernel.create_entity(&mut db.session).await?;
        let mut snapshot = TwitterSnapshot {
            post_id: Some((1_900_000_000_000_000_000_u64 + index as u64).to_string()),
            ..Default::default()
        };
        if name != "locator-only" {
            snapshot.page_url = Some(format!(
                "https://x.com/locus_fixture/status/{}",
                1_900_000_000_000_000_000_u64 + index as u64
            ));
            snapshot.text = Some(format!(
                "Saved {name} observation.\nCaptured locally for the Twitter reading check."
            ));
        }
        if name == "complete" {
            snapshot.requested_url = Some("https://x.com/locus_fixture".into());
            snapshot.author = Some(AuthorObservation {
                user_id: Some("9007199254740993".into()),
                handle: Some("locus_fixture".into()),
                display_name: Some("Locus field notes".into()),
                profile_url: Some("https://x.com/locus_fixture".into()),
            });
            snapshot.published_at_unix_ms = Some(0);
            snapshot.observed_at_unix_ms = Some(1_790_000_000_000);
            snapshot.hashtags = Some(vec!["fieldnotes".into()]);
            snapshot.references = Some(vec![
                ProviderReference {
                    kind: ReferenceKind::ReplyTo,
                    post_id: Some("1890000000000000000".into()),
                    page_url: Some("https://x.com/other/status/1890000000000000000".into()),
                },
                ProviderReference {
                    kind: ReferenceKind::Quote,
                    post_id: Some("1890000000000000001".into()),
                    page_url: None,
                },
                ProviderReference {
                    kind: ReferenceKind::Repost,
                    post_id: None,
                    page_url: None,
                },
            ]);
            snapshot.occurrence = Some(MediaOccurrence {
                media_id: Some("1234567890".into()),
                capture_local_id: Some("selection-a".into()),
                source_order: Some(0),
                label: Some(MediaLabel::Video),
                alt_text: Some("A still captured beside the trail".into()),
                claims: Some(MediaClaims {
                    width: Some(1920),
                    height: Some(1080),
                    duration_ms: Some(0),
                    ..Default::default()
                }),
            });
            snapshot.representation = Some(SelectedRepresentation {
                url: Some("https://video.example.test/selected.mp4".into()),
                claims: Some(MediaClaims {
                    duration_ms: Some(9_007_199_254_740_993),
                    bitrate_bps: Some(i64::MAX as u64),
                    mime_type: Some("video/mp4".into()),
                    quality: Some("original".into()),
                    ..Default::default()
                }),
            });
            snapshot.preview = Some(RemotePreview {
                url: Some("https://images.example.test/preview.jpg".into()),
                description: Some("Remote preview claim only".into()),
                claims: Some(MediaClaims {
                    width: Some(320),
                    height: Some(180),
                    mime_type: Some("image/jpeg".into()),
                    ..Default::default()
                }),
            });
        }
        if name == "partial-empty" {
            snapshot.text = Some(String::new());
            snapshot.hashtags = Some(vec![]);
            snapshot.references = Some(vec![]);
            snapshot.author = Some(AuthorObservation {
                display_name: Some(String::new()),
                ..Default::default()
            });
            snapshot.observed_at_unix_ms = Some(0);
        }
        if name == "producer-issue" {
            snapshot.issues = Some(vec![CaptureIssue {
                portion: CapturePortion::SelectedRepresentation,
                code: "unavailable".into(),
                message: Some("The producer could not acquire the selected representation".into()),
            }]);
        }
        let component = db
            .twitter
            .create(&db.kernel, &mut db.session, snapshot)
            .await?;
        let membership = Membership {
            entity,
            component: component.component(),
            kind: TWITTER_KIND,
        };
        db.kernel.attach(&mut db.session, membership).await?;
        let mut file_id = None;
        if [
            "complete",
            "changed-association",
            "matching-file-error",
            "missing-input",
            "unmounted",
        ]
        .contains(&name)
        {
            let file = db
                .files
                .admit(
                    &db.kernel,
                    &mut db.session,
                    if name == "complete" {
                        video.unwrap_or(&input)
                    } else {
                        &input
                    },
                )
                .await?;
            let attached = Membership {
                entity,
                component: file.id.component(),
                kind: FILE_KIND,
            };
            db.kernel.attach(&mut db.session, attached).await?;
            let prepared = db
                .twitter
                .prepare_association(&db.kernel, &mut db.session, component, file.id)
                .await?;
            if !matches!(
                db.twitter
                    .associate(&db.kernel, &mut db.session, prepared)
                    .await?,
                WriteOutcome::Accepted(_)
            ) {
                bail!("fixture association rejected")
            }
            file_id = Some(file.id.to_string());
            if name == "complete" {
                for kind in [
                    locus_media::api::MediaKind::Image,
                    locus_media::api::MediaKind::Video,
                ] {
                    let media = db.media.create(&db.kernel, &mut db.session, kind).await?;
                    db.kernel
                        .attach(
                            &mut db.session,
                            Membership {
                                entity,
                                component: media.component(),
                                kind: kind.kind(),
                            },
                        )
                        .await?;
                }
            }
            if name == "changed-association" || name == "missing-input" {
                db.kernel.detach(&mut db.session, attached).await?;
                if name == "changed-association" {
                    let next = db
                        .files
                        .admit(
                            &db.kernel,
                            &mut db.session,
                            if name == "complete" {
                                video.unwrap_or(&input)
                            } else {
                                &input
                            },
                        )
                        .await?;
                    db.kernel
                        .attach(
                            &mut db.session,
                            Membership {
                                entity,
                                component: next.id.component(),
                                kind: FILE_KIND,
                            },
                        )
                        .await?;
                }
            }
            if name == "matching-file-error" {
                use diesel_async::RunQueryDsl;
                db.session
                    .transaction::<_, locus_store::api::StoreError, _>(move |c| {
                        Box::pin(async move {
                            diesel::sql_query("DELETE FROM locus_file_comp_file WHERE id = ?")
                                .bind::<diesel::sql_types::Binary, _>(file.id.as_bytes().as_slice())
                                .execute(c.connection())
                                .await?;
                            Ok(())
                        })
                    })
                    .await?;
            }
        }
        if name == "unmounted" {
            db.kernel.detach(&mut db.session, membership).await?;
        }
        if ["corrupt", "missing-record", "future-version"].contains(&name) {
            use diesel_async::RunQueryDsl;
            db.session.transaction::<_, locus_store::api::StoreError, _>(move |c| Box::pin(async move {
                let sql = match name { "missing-record" => "DELETE FROM locus_twitter_comp_snapshot WHERE id = ?", "future-version" => "UPDATE locus_twitter_comp_snapshot SET payload = '{\"version\":99}' WHERE id = ?", _ => "UPDATE locus_twitter_comp_snapshot SET payload = 'broken' WHERE id = ?" };
                diesel::sql_query(sql).bind::<diesel::sql_types::Binary,_>(component.as_bytes().as_slice()).execute(c.connection()).await?; Ok(())
            })).await.context("seed isolated failure")?;
        }
        entries.push(json!({"name": name, "entityId": entity.to_string(), "componentId": component.to_string(), "fileId": file_id}));
    }
    Ok(json!({"library":root,"entries":entries}))
}
