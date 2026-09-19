set quiet
set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

clippy_lints := "-D warnings -D unsafe_code -D clippy::undocumented_unsafe_blocks -D clippy::expect_used -D clippy::unwrap_used"
nextest_args := "--all-features --locked --no-fail-fast --no-tests pass --status-level none --final-status-level fail --failure-output final --success-output never --show-progress none"

rust-clippy-fix:
    cargo clippy --fix --allow-dirty --workspace --all-targets --all-features --locked -- {{ clippy_lints }}

rust-fmt:
    cargo fmt --all

rust-fmt-check:
    cargo fmt --all -- --check

rust-lint:
    cargo clippy --workspace --all-targets --all-features --locked -- {{ clippy_lints }}

rust-test-code package *args:
    cargo nextest run --package {{ package }} {{ nextest_args }} {{ args }}

rust-test-all:
    cargo nextest run --workspace {{ nextest_args }}

rust-metadata:
    cargo metadata --format-version 1 --no-deps --locked

rust-deps:
    cargo tree --workspace --all-features --locked

rust-build:
    cargo build --workspace --all-targets --all-features --locked

rust-run:
    cargo run --package locus --locked

rust-run-backend:
    cargo run --package locus --example file-backend --locked

rust-run-media kind path:
    cargo run --package locus --example media-backend --locked -- '{{ replace(kind, "'", "''") }}' '{{ replace(path, "'", "''") }}'

rust-test-video:
    cargo nextest run --package locus-media {{ nextest_args }} --run-ignored only -E 'test(real_video)'

# Resolve new workspace edges while retaining the existing dependency selection.
rust-lock-media:
    cargo check --package locus-media --offline

rust-finalize: rust-clippy-fix rust-fmt rust-fmt-check rust-lint rust-test-all

rust-validate: rust-finalize rust-metadata rust-deps rust-build

rust-lock:
    cargo generate-lockfile
