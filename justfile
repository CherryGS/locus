set quiet
set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

clippy_lints := "-D warnings -D unsafe_code -D clippy::undocumented_unsafe_blocks -D clippy::expect_used -D clippy::unwrap_used"
nextest_args := "--all-features --locked --no-fail-fast --no-tests pass --status-level none --final-status-level fail --failure-output final --success-output never --show-progress none"
npm := if os() == "windows" { "npm.cmd" } else { "npm" }

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

rust-build-release:
    cargo build --package locus-server --bin locus-server --release --locked

rust-build-dist:
    cargo build --package locus-server --bin locus-server --profile dist --locked

rust-run:
    cargo run --package locus-server --locked

rust-run-backend:
    cargo run --package locus-server --example file-backend --locked

rust-run-media kind path:
    cargo run --package locus-server --example media-backend --locked -- '{{ replace(kind, "'", "''") }}' '{{ replace(path, "'", "''") }}'

rust-run-twitter locator path="":
    cargo run --package locus-server --example twitter-backend --locked -- '{{ replace(locator, "'", "''") }}' '{{ replace(path, "'", "''") }}'

rust-test-video:
    cargo nextest run --package locus-media {{ nextest_args }} --run-ignored only -E 'test(real_video)'

# Resolve new workspace edges while retaining the existing dependency selection.
rust-lock-media:
    cargo check --package locus-media --offline

rust-lock-twitter:
    cargo check --package locus-twitter --offline

rust-lock-tasks:
    cargo check --package locus-task --package locus-store --package locus-file --package locus-media --package locus-twitter --offline

rust-run-tasks:
    cargo run --package locus-server --example task-backend --locked

rust-finalize: rust-clippy-fix rust-fmt rust-fmt-check rust-lint rust-test-all

rust-validate: rust-finalize rust-metadata rust-deps rust-build

rust-lock:
    cargo generate-lockfile

# Resolve only changed server edges; retain existing compatible locked selections.
server-resolve:
    cargo check --package locus-server --all-targets

server-build:
    cargo build --package locus-server --bin locus-server --locked

server-run:
    cargo run --package locus-server --bin locus-server --locked

server-schema path="packages/locus-client/openapi.json":
    cargo run --package locus-server --bin locus-server --locked -- export-openapi '{{ replace(path, "'", "''") }}'

client-install:
    {{ npm }} --prefix packages/locus-client ci --ignore-scripts

client-generate: server-schema
    {{ npm }} --prefix packages/locus-client run generate

client-check:
    {{ npm }} --prefix packages/locus-client run typecheck

client-test:
    {{ npm }} --prefix packages/locus-client test

client-drift: server-build
    node scripts/check-client-drift.mjs

server-smoke: server-build client-check
    {{ npm }} --prefix packages/locus-client run smoke

# Explicit actual Image and provisioned Video HTTP/generated-client consumers.
server-media-smoke: server-build client-check
    {{ npm }} --prefix packages/locus-client run smoke:media

server-video-smoke: server-build client-check
    {{ npm }} --prefix packages/locus-client run smoke:video

server-entity-smoke: server-build client-check
    {{ npm }} --prefix packages/locus-client run smoke:entities

server-preference-smoke: server-build client-check
    {{ npm }} --prefix packages/locus-client run smoke:preferences

# Actual isolated SQLite fixture; setup is outside the measured complete read.
server-entity-scale count="1000000": server-build client-check
    {{ npm }} --prefix packages/locus-client run scale:entities -- {{ count }}

# Standalone Electron shell; no backend or user library is opened.
desktop-install:
    {{ npm }} --prefix apps/desktop ci
    {{ npm }} --prefix apps/desktop run install:electron

desktop-check:
    {{ npm }} --prefix apps/desktop run typecheck

desktop-test:
    {{ npm }} --prefix apps/desktop test

desktop-build:
    {{ npm }} --prefix apps/desktop run build

desktop-run:
    {{ npm }} --prefix apps/desktop run dev

# Browser-only renderer preview; does not launch an Electron window.
desktop-ui:
    {{ npm }} --prefix apps/desktop run dev:renderer

desktop-preview:
    {{ npm }} --prefix apps/desktop start
