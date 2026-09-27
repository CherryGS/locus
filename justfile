set quiet
set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

clippy_lints := "-D warnings -D unsafe_code -D clippy::undocumented_unsafe_blocks -D clippy::expect_used -D clippy::unwrap_used"
nextest_args := "--all-features --locked --no-fail-fast --no-tests pass --status-level none --final-status-level fail --failure-output final --success-output never --show-progress none"
npm := if os() == "windows" { "npm.cmd" } else { "npm" }

# Remove development build artifacts without touching retained verification data.
rust-clean:
    cargo clean --profile dev

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

# Resolve Civitai's pinned provider edge without refreshing unrelated locked selections.
civitai-resolve:
    cargo check --package locus-civitai

# Actual Civitai Video admission, cover generation, recovery and shared reuse.
rust-test-civitai-video:
    cargo nextest run --package locus-civitai {{ nextest_args }} --run-ignored only -E 'test(real_video)'

server-build:
    cargo build --package locus-server --bin locus-server --locked

server-fixture-build:
    cargo build --package locus-server --example fixture-server --locked

server-civitai-inputs root:
    cargo run --package locus-server --example civitai-fixture-inputs --locked -- '{{ replace(root, "'", "''") }}'

server-civitai-inputs-build:
    cargo build --package locus-server --example civitai-fixture-inputs --locked

# Durable offline sample library; explicit optional retained inputs are passed to npm.
desktop-sample-generate root=".local/comprehensive-library" real_inputs="": server-fixture-build server-civitai-inputs-build desktop-build
    {{ npm }} --prefix apps/desktop run sample:generate -- '{{ replace(root, "'", "''") }}' {{ if real_inputs == "" { "" } else { "--real-inputs '" + replace(real_inputs, "'", "''") + "'" } }}

desktop-sample-verify root=".local/comprehensive-library": server-fixture-build desktop-build
    {{ npm }} --prefix apps/desktop run sample:verify -- '{{ replace(root, "'", "''") }}'

desktop-sample-preview root=".local/comprehensive-library": server-fixture-build desktop-build
    {{ npm }} --prefix apps/desktop run sample:preview -- '{{ replace(root, "'", "''") }}'

desktop-civitai-browser: server-build server-fixture-build desktop-build
    {{ npm }} --prefix apps/desktop run verify:civitai-browser

server-external-smoke: server-build
    {{ npm }} --prefix packages/locus-client run smoke:external

server-run:
    cargo run --package locus-server --bin locus-server --locked

server-schema path="packages/locus-client/openapi.json":
    cargo run --package locus-server --bin locus-server --locked -- export-openapi '{{ replace(path, "'", "''") }}'

client-install:
    {{ npm }} --prefix packages/locus-client ci --ignore-scripts

server-settings path="packages/locus-client/settings.json":
    cargo run --package locus-server --bin locus-server --locked -- export-settings '{{ replace(path, "'", "''") }}'

client-generate: server-schema server-settings
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

# Production Electron entry owns the backend and uses the selected real library.
desktop-install:
    {{ npm }} --prefix apps/desktop ci
    {{ npm }} --prefix apps/desktop run install:electron

desktop-check:
    {{ npm }} --prefix apps/desktop run typecheck

desktop-test:
    {{ npm }} --prefix apps/desktop test

desktop-build:
    {{ npm }} --prefix apps/desktop run build

desktop-run: server-build desktop-build
    {{ npm }} --prefix apps/desktop start

# Isolated live browser preview over a newly created synthetic temporary library.
desktop-ui: server-build server-fixture-build desktop-build
    {{ npm }} --prefix apps/desktop run preview:ui

# Retained sample library with real task records recreated on every preview run.
desktop-task-preview: server-fixture-build desktop-build
    {{ npm }} --prefix apps/desktop run preview:tasks

# Actual application with a preview-only notification example control.
desktop-notification-preview: server-fixture-build
    {{ npm }} --prefix apps/desktop run preview:notifications

desktop-preview: server-build desktop-build
    {{ npm }} --prefix apps/desktop start

desktop-browser-install:
    {{ npm }} --prefix apps/desktop run install:browser

# Explicit supplied-data preview: open /?preview=specimens#/entity.
desktop-ui-specimens:
    {{ npm }} --prefix apps/desktop run dev:renderer

desktop-ui-test: server-build server-fixture-build desktop-build
    {{ npm }} --prefix apps/desktop run verify:browser

desktop-native-test: server-build server-fixture-build desktop-build
    {{ npm }} --prefix apps/desktop run verify:electron

desktop-renderer-scale count="1000000": server-build server-fixture-build desktop-build
    {{ npm }} --prefix apps/desktop run verify:scale -- {{ count }}

# Connected local-file import through the real generated client.
server-import-smoke: server-build client-check
    {{ npm }} --prefix packages/locus-client run smoke:imports

desktop-import-browser: server-fixture-build desktop-build
    {{ npm }} --prefix apps/desktop run verify:import-browser

desktop-import-native: server-fixture-build desktop-build
    {{ npm }} --prefix apps/desktop run verify:import-native

desktop-shared-tasks: server-fixture-build desktop-build
    {{ npm }} --prefix apps/desktop run verify:shared-tasks

desktop-notifications: server-fixture-build desktop-build
    {{ npm }} --prefix apps/desktop run verify:notifications

# Real Video transfer, playback and native lifecycle with owned synthetic inputs.
desktop-video-test: server-build server-fixture-build desktop-build
    {{ npm }} --prefix apps/desktop run verify:video

# Offline provider-owned snapshots; refuses an existing metadata database.
server-twitter-fixture root video="":
    cargo run --package locus-server --example twitter-reading-fixture --locked -- '{{ replace(root, "'", "''") }}' '{{ replace(video, "'", "''") }}'

# Real saved captures and actual host/preload link results, with a test-owned opener.
desktop-twitter-browser: server-build server-fixture-build desktop-build
    {{ npm }} --prefix apps/desktop run verify:twitter-browser

desktop-twitter-native: server-build server-fixture-build desktop-build
    {{ npm }} --prefix apps/desktop run verify:twitter-native

server-settings-smoke: server-build client-check
    {{ npm }} --prefix packages/locus-client run smoke:settings

# Actual Settings UI and bounded native full-restart verification on isolated libraries.
desktop-settings-workspace: server-build server-fixture-build desktop-build
    {{ npm }} --prefix apps/desktop run verify:settings-workspace

desktop-settings-browser: server-build server-fixture-build desktop-build
    {{ npm }} --prefix apps/desktop run verify:settings-browser

desktop-library-switch: server-build server-fixture-build desktop-build
    {{ npm }} --prefix apps/desktop run verify:library-switch

desktop-settings-native: server-build server-fixture-build desktop-build
    {{ npm }} --prefix apps/desktop run verify:settings-native

server-model-fixture root:
    cargo run --package locus-server --example model-reading-fixture --locked -- '{{ replace(root, "'", "''") }}'

desktop-model-browser: server-build server-fixture-build desktop-build
    {{ npm }} --prefix apps/desktop run verify:model-browser

# Connected Bilibili import/cover fixture; tools use ordinary LOCUS_FFMPEG/LOCUS_FFPROBE configuration.
desktop-bilibili-browser: server-build server-fixture-build desktop-build
    {{ npm }} --prefix apps/desktop run verify:bilibili-browser

desktop-bilibili-native: server-build server-fixture-build desktop-build
    {{ npm }} --prefix apps/desktop run verify:bilibili-native
