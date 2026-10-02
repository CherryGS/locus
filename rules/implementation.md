# Implementation rules

## Commands

Use Just recipes rather than raw Cargo commands. The root `justfile` owns their arguments.

- `just rust-validate`: run finalization, workspace metadata validation, dependency inspection, and a build.
- `just rust-clean`: remove development build artifacts; retain other verification data in `target`.
- `just rust-finalize`: apply Clippy fixes, format, check formatting, lint, and run all code tests.
- `just rust-clippy-fix`: apply available Clippy fixes.
- `just rust-fmt`: format the workspace.
- `just rust-fmt-check`: check formatting without changing files.
- `just rust-lint`: check all workspace targets with the enforced Clippy lints.
- `just rust-test-all`: run workspace code tests with Nextest.
- `just rust-test-code locus-server`: run server and migrated example tests; additional Nextest arguments may follow.
- `just rust-metadata`: validate and inspect workspace metadata.
- `just rust-deps`: inspect the resolved dependency tree.
- `just rust-build`: build all workspace targets.
- `just rust-build-release`: build the server binary with the release profile.
- `just rust-build-dist`: build the server binary with the dist profile.
- `just rust-run`: run the server entry point with its private JSON bootstrap pipe.
- `just rust-run-backend`: run the explicit File backend composition example.
- `just rust-run-media image|video path`: copy/admit a supplied local input and exercise the intended Media component, interpretation and preview.
- `just rust-test-video`: run the explicitly provisioned ffprobe/ffmpeg integration tests (configure `LOCUS_FFPROBE` and `LOCUS_FFMPEG` as needed).
- `just rust-test-civitai-video`: verify Civitai video example admission, cover generation, recovery and reuse with provisioned ffprobe/ffmpeg.
- `just rust-lock-media`: resolve the Media workspace edges offline while retaining locked dependency versions.
- `just rust-run-twitter locator [path]`: save a Twitter snapshot from a post ID/URL and optionally copy/admit and explicitly associate a supplied local file.
- `just rust-lock-twitter`: resolve the Twitter workspace edges offline while retaining locked dependency versions.
- `just rust-run-tasks`: run concurrent real File/Media/Twitter tasks using a temporary library and synthetic input.
- `just rust-lock-tasks`: resolve task workspace edges offline while retaining locked dependency versions.
- `just server-resolve`: resolve changed server dependency edges while preserving compatible locked selections.
- `just server-build` / `just server-run`: build or run only the server binary.
- `just server-schema [path]`: export deterministic OpenAPI without storage/bootstrap initialization.
- `just client-install`: install the pinned client lockfile without lifecycle scripts.
- `just client-generate`: export OpenAPI and regenerate TypeScript declarations.
- `just client-check`: check the client, real smoke consumer and negative type contracts.
- `just client-test`: verify the Entity reader through the generated factory, including malformed and truncated responses.
- `just client-drift`: regenerate twice in a temporary directory and reject schema/client drift.
- `just server-smoke`: exercise the real server binary with its authorized generated client and report bounded local JSON timing.
- `just server-entity-smoke`: exercise complete/refresh identities, batch memberships and subsequent File/Media reads against a temporary real server library.
- `just server-entity-scale [count]`: seed an isolated actual Entity fixture (default 1,000,000), then measure complete binary reads, lookups and server/client memory; requires `uv` for fixture setup.

## General rules

- UI changes also follow `rules/ui.md`, including information visibility and stable updates.
- For UI appearance and usability polish, iterate directly in the application with proportionate verification. Do not start the design/implementation planning, subagent review, or separate acceptance gates unless the user explicitly requests that workflow.
- Iterate user-facing UI in the actual application by default, using its real renderer and behavior. Use isolated libraries for verification; create a separate mock UI only when the user explicitly asks for one.
- Verify renderer UI in an isolated in-app browser or a headless browser by default, using `just desktop-ui`. Avoid taking over the user's desktop pointer or focus for browser-testable behavior. Reserve native desktop automation for concrete Electron/OS integration checks and explain the need before using it.
- Keep implementation natural and simple. Record speculative edge cases and potential requirements as observations; introduce behavioral barriers, quotas or policy mechanisms only for concrete observed needs or settled contracts. Unmeasured hypothetical resource growth alone does not justify blocking ordinary use.
- Keep files that serve as module indexes or aggregation roots limited to module declarations, API re-exports, and dependency or composition wiring. Put product and domain behavior in the modules they expose.
- Rust directory modules use `mod.rs`. Keep `lib.rs` and every `mod.rs` limited to module declarations, visibility, and re-exports (with relevant documentation or attributes). Put types, functions, implementations, constants, and behavior in leaf files. A simple leaf does not need its own directory.
- Each library exposes its supported public surface through `api/mod.rs`; do not duplicate those exports at the crate root. Cross-crate consumers import through `crate_name::api`. Within a crate, reference the owning modules directly instead of routing through its public facade.
- Use consistent names where the responsibility exists: `identity` for IDs and kinds, `error` for errors, `record` for retained domain values, `view` for contextual read projections, `persistence` for database rows/queries/schema, and `adapters` for external libraries or tools. Add only useful modules, not empty template layers. Split by responsibility rather than an arbitrary line limit.
- Domain operation entry objects use the `Service` suffix (`FileService`, `MediaService`). Keep distinct capability names such as `Kernel`, `Session`, and `Context`. Use `read` for retained-record reads, `view` for contextual projections, `open` for resource access, and `_in` for participation in an existing transaction. Preserve domain-specific verbs when their meanings differ.
- Keep preparation tokens and implementation helpers private to their owning modules; reorganizing files must not make internal constructors or state public. Organize related unit tests under the same directory module and keep its `mod.rs` free of test behavior.

## Database table names

- Name application-owned tables `<crate>_<category>_<title>`. Normalize the owning
  package's full name to lowercase snake_case (`locus-media` -> `locus_media`).
  Use a descriptive singular snake_case title.
- The category is `comp` for a component kind's payload, `rela` for a table whose
  primary purpose is a relationship, and `comm` for everything else. `comm` means
  other; it does not imply shared component ownership.
- Use the data owner's prefix, even when `locus-migration` physically contains
  the DDL. Settings framework records use `locus_settings`; server-owned access
  and presentation records use `locus_server`; migration history uses
  `locus_migration`. Table naming does not change field or operation authority.
- A generic component identity registry is `comm`, because it does not contain
  a component kind's payload. Entity-to-component membership is `rela`. A foreign
  key or an identifier inside a payload does not alone make a table `rela`.
- Apply the convention to tables the application defines, not SQLite's internal
  tables. A table rename is an explicit schema change, not a runtime consequence
  of changing a Rust package name.

Examples for the current owners:

| Stored role | Table name |
| --- | --- |
| Entity identity | `locus_core_comm_entity` |
| Component identity/kind registry | `locus_core_comm_component_registry` |
| Entity/component membership | `locus_core_rela_membership` |
| File component | `locus_file_comp_file` |
| Image component | `locus_media_comp_image` |
| Video component | `locus_media_comp_video` |
| Model component | `locus_model_comp_model` |
| Twitter snapshot component | `locus_twitter_comp_snapshot` |
| Bilibili snapshot component | `locus_bilibili_comp_snapshot` |
| Civitai snapshot component | `locus_civitai_comp_snapshot` |
| Settings group value | `locus_settings_comm_group_value` |
| Entity view preference | `locus_server_comm_entity_view_preference` |
| External access credential | `locus_server_comm_access_credential` |
| External context/File eligibility | `locus_server_rela_access_eligibility` |
| Applied migration history | `locus_migration_comm_history` |

## Migration filenames

- Historical step files in `crates/locus-migration/src/steps` use the base
  `<12-digit-zero-padded-id>_<crate>_<title>`, for example
  `000000000001_locus_core_initial_schema.rs`. Normalize the full crate name to
  snake_case and use a descriptive snake_case title.
- A step's SQL resource shares its Rust entry's base. Step-local helpers retain
  that base with a descriptive suffix, such as `_conversion.rs`.
- Use the affected crate for a single-owner step and `locus_migration` for an
  explicitly coordinated cross-domain transformation. This label does not change
  the data ownership or table naming rules.
- Numeric filenames use Rust `#[path = "..."]` module declarations. Execution
  still follows the explicit ordered catalog and numeric step IDs.
- File paths and embedded source/resource references are fingerprint inputs.
  Renaming an applied step changes its checksum and follows the existing
  development-history mismatch policy; never silently rewrite an applied ledger.

## Domain rules

- Rust binary targets use `anyhow` for application error propagation and context.
- Rust workspace Clippy runs deny `unsafe_code` and `clippy::undocumented_unsafe_blocks`.
- Keep `clippy::expect_used` and `clippy::unwrap_used` denied in production. Allow a deliberate production panic only at its smallest scope with a reason.
- Test functions and `#[cfg(test)]` code may use `expect` and `unwrap` under the workspace Clippy configuration.
- Add the following inner attribute at the start of every integration-test crate root so its unannotated helpers may fail fast too:

```rust
#![allow(clippy::expect_used, clippy::unwrap_used)]
```
