use super::resolve_root;
use std::{ffi::OsString, fs};

#[test]
fn overrides_skip_lower_priority_configuration() {
    let directory = tempfile::tempdir().unwrap();
    let explicit = directory.path().join("explicit");
    let environment = directory.path().join("environment");
    assert_eq!(
        resolve_root(Some(explicit.clone()), Some(OsString::new()), || {
            panic!("explicit root must not resolve application data")
        })
        .unwrap(),
        explicit
    );
    assert_eq!(
        resolve_root(None, Some(environment.clone().into_os_string()), || {
            panic!("environment root must not resolve application data")
        })
        .unwrap(),
        environment
    );
    assert!(!explicit.exists());
    assert!(!environment.exists());
}

#[test]
fn absent_or_empty_first_line_uses_existing_default() {
    let directory = tempfile::tempdir().unwrap();
    let application_data = directory.path().join("Locus");
    let resolve = || resolve_root(None, None, || Ok(application_data.clone()));
    assert_eq!(resolve().unwrap(), application_data);
    assert!(!application_data.exists());

    fs::create_dir(&application_data).unwrap();
    for contents in ["", " \t\r\nignored second line", "\u{feff}\nignored"] {
        fs::write(application_data.join("path"), contents).unwrap();
        assert_eq!(resolve().unwrap(), application_data);
    }
}

#[test]
fn locator_uses_only_first_line_and_stays_in_application_data() {
    let directory = tempfile::tempdir().unwrap();
    let application_data = directory.path().join("Locus");
    let library = directory.path().join("Library with spaces 图库");
    fs::create_dir(&application_data).unwrap();
    for prefix in ["", "\u{feff}"] {
        let mut contents = format!("{prefix} {} \r\n", library.display()).into_bytes();
        contents.extend_from_slice(b"ignored second line\xff");
        fs::write(application_data.join("path"), contents).unwrap();
        assert_eq!(
            resolve_root(None, None, || Ok(application_data.clone())).unwrap(),
            library
        );
        assert!(!library.exists());
    }
}

#[test]
fn invalid_override_does_not_fall_through() {
    for (explicit, environment) in [
        (Some("relative".into()), None),
        (Some("".into()), None),
        (None, Some("relative".into())),
        (None, Some(OsString::new())),
    ] {
        assert!(
            resolve_root(explicit, environment, || {
                panic!("invalid override must not fall back")
            })
            .is_err()
        );
    }
}

#[test]
fn invalid_or_unreadable_locator_does_not_fall_back() {
    let directory = tempfile::tempdir().unwrap();
    let locator = directory.path().join("path");
    let resolve = || resolve_root(None, None, || Ok(directory.path().to_path_buf()));
    fs::create_dir(&locator).unwrap();
    assert!(resolve().is_err());
    fs::remove_dir(&locator).unwrap();

    for contents in [b"relative\n".as_slice(), b"\xff\n"] {
        fs::write(&locator, contents).unwrap();
        assert!(resolve().is_err());
    }
    assert!(!directory.path().join("metadata.sqlite").exists());
}

#[test]
fn unavailable_application_data_is_reported_without_an_override() {
    assert!(resolve_root(None, None, || anyhow::bail!("unavailable")).is_err());
}

#[tokio::test(flavor = "multi_thread")]
async fn server_initializes_the_selected_library_without_creating_a_fallback_database() {
    use crate::runtime::{registry::ServerConfig, server::Server};

    let directory = tempfile::tempdir().unwrap();
    let application_data = directory.path().join("Locus");
    let library = directory.path().join("selected-library");
    fs::create_dir(&application_data).unwrap();
    fs::write(application_data.join("path"), library.to_str().unwrap()).unwrap();
    let config = || {
        ServerConfig::new(
            "test-credential-with-at-least-32-characters".into(),
            resolve_root(None, None, || Ok(application_data.clone())).unwrap(),
        )
    };
    let server = Server::bind(config()).await.unwrap();
    assert!(library.join("metadata.sqlite").is_file());
    assert!(!application_data.join("metadata.sqlite").exists());
    server.close_admission();
    server.serve().await.unwrap();

    let blocked = directory.path().join("not-a-directory");
    fs::write(&blocked, b"file").unwrap();
    fs::write(application_data.join("path"), blocked.to_str().unwrap()).unwrap();
    assert!(Server::bind(config()).await.is_err());
    assert!(!application_data.join("metadata.sqlite").exists());
}
