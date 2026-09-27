#![allow(clippy::expect_used, clippy::unwrap_used)]
mod support;
use locus_twitter::api::*;
use support::*;

#[tokio::test(flavor = "multi_thread")]
async fn locator_only_and_partial_capture_round_trip_without_inference() {
    let mut f = Fixture::new().await;
    let first = f
        .twitter
        .create(&f.kernel, &mut f.session, snapshot())
        .await
        .unwrap();
    let second = f
        .twitter
        .create(&f.kernel, &mut f.session, snapshot())
        .await
        .unwrap();
    assert_ne!(first, second);
    let partial = TwitterSnapshot {
        page_url: Some(
            "https://mobile.twitter.com/user/status/123456789/video/1?s=20#capture".into(),
        ),
        requested_url: Some("https://x.com/home".into()),
        text: Some(String::new()),
        hashtags: Some(vec![]),
        references: Some(vec![ProviderReference {
            kind: ReferenceKind::Quote,
            post_id: None,
            page_url: None,
        }]),
        author: Some(AuthorObservation {
            display_name: Some(String::new()),
            ..Default::default()
        }),
        observed_at_unix_ms: Some(1_700_000_000_000),
        occurrence: Some(MediaOccurrence {
            label: Some(MediaLabel::AnimatedImage),
            capture_local_id: Some("capture-2".into()),
            claims: Some(MediaClaims {
                width: Some(1920),
                height: Some(1080),
                ..Default::default()
            }),
            ..Default::default()
        }),
        representation: Some(SelectedRepresentation {
            url: Some("https://video.twimg.com/selected.mp4?token=abc".into()),
            claims: Some(MediaClaims {
                width: Some(640),
                height: Some(360),
                mime_type: Some("video/mp4".into()),
                ..Default::default()
            }),
        }),
        preview: Some(RemotePreview {
            url: Some("https://pbs.twimg.com/preview.jpg".into()),
            claims: Some(MediaClaims {
                width: Some(120),
                height: Some(90),
                ..Default::default()
            }),
            ..Default::default()
        }),
        issues: Some(vec![CaptureIssue {
            portion: CapturePortion::Author,
            code: "not_acquired".into(),
            message: None,
        }]),
        ..Default::default()
    };
    let id = f
        .twitter
        .create(&f.kernel, &mut f.session, partial.clone())
        .await
        .unwrap();
    let record = f.twitter.read(&mut f.session, id).await.unwrap();
    assert_eq!(record.snapshot, partial);
    assert_eq!(record.revision, 0);
    assert_eq!(record.basis, None);
    assert_eq!(record.snapshot.post_id, None);
    assert_eq!(record.snapshot.published_at_unix_ms, None);
    assert_eq!(record.snapshot.occurrence.unwrap().source_order, None);
    assert_eq!(
        f.twitter
            .read(&mut f.session, first)
            .await
            .unwrap()
            .snapshot,
        snapshot()
    );
    assert_eq!(count(&mut f.session,"SELECT count(*) AS count FROM locus_twitter_comp_snapshot WHERE typeof(id)='blob' AND length(id)=16").await,3);
}

#[test]
fn recognized_subject_patterns_are_local_and_must_agree() {
    for url in [
        "https://x.com/a/status/1",
        "http://www.twitter.com/a/status/1/",
        "https://m.x.com/i/web/status/1",
        "https://twitter.com/i/status/1/photo/2",
    ] {
        TwitterSnapshot {
            page_url: Some(url.into()),
            post_id: Some("1".into()),
            ..Default::default()
        }
        .validate()
        .unwrap();
    }
    for id in ["", "0", "01", "-1", "1a", "18446744073709551616"] {
        assert!(
            TwitterSnapshot {
                post_id: Some(id.into()),
                ..Default::default()
            }
            .validate()
            .is_err()
        );
    }
    for url in [
        "https://example.com/a/status/1",
        "https://x.com.evil.test/a/status/1",
        "https://user@x.com/a/status/1",
        "https://x.com/home",
        "https://x.com/a/status/0",
        "https://x.com/a/status/1/photo/0",
        "https://x.com/a/status/1/extra",
        "https://x.com:444/a/status/1",
        "javascript:alert(1)",
        "https://x.com/a/status/2",
    ] {
        assert!(
            TwitterSnapshot {
                page_url: Some(url.into()),
                post_id: Some("1".into()),
                ..Default::default()
            }
            .validate()
            .is_err(),
            "{url}"
        );
    }
    assert!(TwitterSnapshot::default().validate().is_err());
}

#[tokio::test(flavor = "multi_thread")]
async fn malformed_optional_values_and_budgets_reject_without_changing_old_state() {
    let mut f = Fixture::new().await;
    let id = f
        .twitter
        .create(&f.kernel, &mut f.session, snapshot())
        .await
        .unwrap();
    let old = f.twitter.read(&mut f.session, id).await.unwrap();
    let mut cases = vec![];
    let mut v = snapshot();
    v.text = Some("x".repeat(MAX_TEXT_BYTES + 1));
    cases.push(v);
    let mut v = snapshot();
    v.observed_at_unix_ms = Some(-1);
    cases.push(v);
    let mut v = snapshot();
    v.published_at_unix_ms = Some(i64::MAX);
    cases.push(v);
    let mut v = snapshot();
    v.hashtags = Some(vec!["tag".into(); MAX_COLLECTION_ITEMS + 1]);
    cases.push(v);
    let mut v = snapshot();
    v.requested_url = Some(format!("https://x.com/{}", "x".repeat(MAX_URL_BYTES)));
    cases.push(v);
    let mut v = snapshot();
    v.author = Some(AuthorObservation {
        user_id: Some("bad".into()),
        ..Default::default()
    });
    cases.push(v);
    let mut v = snapshot();
    v.occurrence = Some(MediaOccurrence {
        media_id: Some("0".into()),
        ..Default::default()
    });
    cases.push(v);
    let mut v = snapshot();
    v.representation = Some(SelectedRepresentation {
        claims: Some(MediaClaims {
            width: Some(0),
            ..Default::default()
        }),
        ..Default::default()
    });
    cases.push(v);
    let mut v = snapshot();
    v.preview = Some(RemotePreview {
        url: Some("file:///C:/foo".into()),
        ..Default::default()
    });
    cases.push(v);
    let mut v = snapshot();
    v.representation = Some(SelectedRepresentation {
        claims: Some(MediaClaims {
            mime_type: Some("bogus".into()),
            ..Default::default()
        }),
        ..Default::default()
    });
    cases.push(v);
    let mut v = snapshot();
    v.issues = Some(vec![
        CaptureIssue {
            portion: CapturePortion::PostText,
            code: "error".into(),
            message: Some("x".repeat(MAX_TEXT_BYTES))
        };
        5
    ]);
    cases.push(v);
    for proposed in cases {
        assert!(matches!(
            f.twitter
                .replace(&mut f.session, id, 0, proposed.clone())
                .await,
            Err(TwitterError::Invalid(_))
        ));
        assert!(matches!(
            f.twitter.create(&f.kernel, &mut f.session, proposed).await,
            Err(TwitterError::Invalid(_))
        ));
        assert_eq!(f.twitter.read(&mut f.session, id).await.unwrap(), old);
    }
    assert_eq!(
        count(
            &mut f.session,
            "SELECT count(*) AS count FROM locus_twitter_comp_snapshot"
        )
        .await,
        1
    );
}
