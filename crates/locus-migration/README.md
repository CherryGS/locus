# Library migration history

The server invokes `locus_migration::api::migrate` with its task-bound Store
session after acquiring exclusive library ownership and before constructing
current File, Settings or domain services. Examples and tests may use an ordinary
Store session. Callers retain ownership until the actual worker ends.

Every ordered step commits its SQL/Rust changes and history row together. Only
confirmed commits advance; errors identify the history phase or step and retain
Store's uncertain-commit cause. An explicit later startup rereads the complete
ID/checksum prefix and resumes its suffix. No automatic retry or external effects
belong in a step.

To add a step:

1. Add a Rust leaf under `src/steps` with the base
   `<12-digit-zero-padded-id>_<crate>_<title>`, for example
   `000000000001_locus_core_initial_schema.rs`. Use the full crate name in
   snake_case; a coordinated cross-domain step uses `locus_migration`.
   Its SQL resource shares that base, and local helpers append a descriptive
   suffix such as `_conversion.rs`. Keep one `Step` declaration beside its
   execution body and historical payload/helpers independent of current domains.
2. Declare every Rust source, SQL/resource and helper used by that step in its
   `inputs`, with stable logical paths and `include_str!` contents. Helpers shared
   by steps must be declared by every consuming step. Do not hide historical
   transformation code outside `steps`; runtime/ledger/fingerprint machinery is
   separate from historical definitions.
3. Register the step in `steps/catalog.rs` in strictly increasing ID order and
   add a `#[path = "<base>.rs"]` declaration with a valid Rust module alias.
   These two declarative registration files are not
   fingerprinted, so appending a step preserves earlier checksums. Inputs use
   SHA-256 with length-framed paths/content and normalized LF line endings.
4. Run `just rust-test-code locus-migration`; coverage checks reject unlisted
   historical files/resources. Add real Store tests for the transformation,
   rollback, retained values and restart behavior. Run `just rust-validate` before
   accepting production changes.

Development may rewrite definitions, but applied IDs/checksums must still match
exactly. Nonempty pre-system libraries and incompatible histories are refused
without adoption, stamping, deletion or reset. Select an explicitly new isolated
library instead. Published steps are append-only after formal release.
Diagnostic names/timestamps do not establish ordering, and matching history is
not a content-health scan. Current payload validation, absent Settings group
initialization and absent access-credential creation remain ordinary operations.

Renaming a historical source/resource also changes its fingerprint because the
declared paths and embedded references are covered. The descriptive naming change
therefore requires a new development library when its old history was applied;
the runner does not relabel that existing history or delete its data.
