# Locus

A personal local CMS intended to unify management of media, AI model weights, AIGC metadata, relationships, and commonly used Sources.

This repository currently contains a provisional Rust workspace. Its single application package is `apps/locus`, generated with Cargo. The entry point prints the scaffold greeting. GPUI-family integration, ECS-like architecture, and product behavior follow design.

Intent discovery was deferred at the user's request so bootstrap could proceed. The current intent snapshot and its confirmation state are maintained in the independent local `project-doc` repository.

## Development

The bootstrap was validated on Windows with the installed Rust/Cargo 1.97.0 stable MSVC toolchain, Rustfmt, Clippy, cargo-nextest 0.9.140, and Just 1.57.0.

From the repository root:

```text
just rust-validate
just rust-run
```

`rust-validate` applies Clippy fixes and formatting, then checks lint, the test runner, metadata, dependencies, and the build. The generated application has no product tests yet; the test runner accepts an empty suite during bootstrap.

See `rules/implementation.md` for the available commands and implementation guidance.
