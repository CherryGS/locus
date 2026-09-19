# Implementation rules

## Commands

Use Just recipes rather than raw Cargo commands. The root `justfile` owns their arguments.

- `just rust-validate`: run finalization, workspace metadata validation, dependency inspection, and a build.
- `just rust-finalize`: apply Clippy fixes, format, check formatting, lint, and run all code tests.
- `just rust-clippy-fix`: apply available Clippy fixes.
- `just rust-fmt`: format the workspace.
- `just rust-fmt-check`: check formatting without changing files.
- `just rust-lint`: check all workspace targets with the enforced Clippy lints.
- `just rust-test-all`: run workspace code tests with Nextest.
- `just rust-test-code locus`: run code tests for the provisional application package; additional Nextest arguments may follow.
- `just rust-metadata`: validate and inspect workspace metadata.
- `just rust-deps`: inspect the resolved dependency tree.
- `just rust-build`: build all workspace targets.
- `just rust-build-release`: build the native application with the release profile.
- `just rust-build-dist`: build the native application with the dist profile.
- `just rust-run`: run the provisional application entry point.
- `just rust-run-backend`: run the explicit File backend composition example without starting the native UI.
- `just rust-run-media image|video path`: copy/admit a supplied local input and exercise the intended Media component, interpretation and preview.
- `just rust-test-video`: run the explicitly provisioned ffprobe/ffmpeg integration tests (configure `LOCUS_FFPROBE` and `LOCUS_FFMPEG` as needed).
- `just rust-lock-media`: resolve the Media workspace edges offline while retaining locked dependency versions.
- `just rust-run-twitter locator [path]`: save a Twitter snapshot from a post ID/URL and optionally copy/admit and explicitly associate a supplied local file.
- `just rust-lock-twitter`: resolve the Twitter workspace edges offline while retaining locked dependency versions.
- `just rust-run-tasks`: run concurrent real File/Media/Twitter tasks using a temporary library and synthetic input.
- `just rust-lock-tasks`: resolve task workspace edges offline while retaining locked dependency versions.

## General rules

- Keep files that serve as module indexes or aggregation roots limited to module declarations, API re-exports, and dependency or composition wiring. Put product and domain behavior in the modules they expose.
- Rust directory modules use `mod.rs`. Keep `lib.rs` and every `mod.rs` limited to module declarations, visibility, and re-exports (with relevant documentation or attributes). Put types, functions, implementations, constants, and behavior in leaf files. A simple leaf does not need its own directory.
- Each library exposes its supported public surface through `api/mod.rs`; do not duplicate those exports at the crate root. Cross-crate consumers import through `crate_name::api`. Within a crate, reference the owning modules directly instead of routing through its public facade.
- Use consistent names where the responsibility exists: `identity` for IDs and kinds, `error` for errors, `record` for retained domain values, `view` for contextual read projections, `persistence` for database rows/queries/schema, and `adapters` for external libraries or tools. Add only useful modules, not empty template layers. Split by responsibility rather than an arbitrary line limit.
- Domain operation entry objects use the `Service` suffix (`FileService`, `MediaService`). Keep distinct capability names such as `Kernel`, `Session`, and `Context`. Use `read` for retained-record reads, `view` for contextual projections, `open` for resource access, and `_in` for participation in an existing transaction. Preserve domain-specific verbs when their meanings differ.
- Keep preparation tokens and implementation helpers private to their owning modules; reorganizing files must not make internal constructors or state public. Organize related unit tests under the same directory module and keep its `mod.rs` free of test behavior.

## Domain rules

- Rust binary targets use `anyhow` for application error propagation and context.
- Rust workspace Clippy runs deny `unsafe_code` and `clippy::undocumented_unsafe_blocks`.
- Keep `clippy::expect_used` and `clippy::unwrap_used` denied in production. Allow a deliberate production panic only at its smallest scope with a reason.
- Test functions and `#[cfg(test)]` code may use `expect` and `unwrap` under the workspace Clippy configuration.
- Add the following inner attribute at the start of every integration-test crate root so its unannotated helpers may fail fast too:

```rust
#![allow(clippy::expect_used, clippy::unwrap_used)]
```
