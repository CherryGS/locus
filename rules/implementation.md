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
- `just rust-run`: run the provisional application entry point.
- `just rust-run-backend`: run the explicit File backend composition example without starting the native UI.

## General rules

- Keep files that serve as module indexes or aggregation roots limited to module declarations, API re-exports, and dependency or composition wiring. Put product and domain behavior in the modules they expose.

## Domain rules

- Rust binary targets use `anyhow` for application error propagation and context.
- Rust workspace Clippy runs deny `unsafe_code` and `clippy::undocumented_unsafe_blocks`.
- Keep `clippy::expect_used` and `clippy::unwrap_used` denied in production. Allow a deliberate production panic only at its smallest scope with a reason.
- Test functions and `#[cfg(test)]` code may use `expect` and `unwrap` under the workspace Clippy configuration.
- Add the following inner attribute at the start of every integration-test crate root so its unannotated helpers may fail fast too:

```rust
#![allow(clippy::expect_used, clippy::unwrap_used)]
```
