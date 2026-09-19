# Locus

A personal local CMS intended to unify management of media, AI model weights, AIGC metadata, relationships, and commonly used Sources.

The Rust workspace contains an initial persistent identity and attachment foundation:

- `locus-store` owns domain-neutral SQLite sessions and transaction boundaries through Diesel 2.3.13 and diesel-async 0.9.2, with bundled SQLite linkage.
- `locus-core` owns UUIDv7 entity/component identities, stable assigned kind IDs, owner-verified component admission, shared membership, and guarded lifecycle operations. Domain payloads stay in domain-owned tables.
- `apps/locus` owns the Tokio runtime and initializes a real kernel in an ephemeral SQLite session before printing the original `Hello, world!` greeting. This is bootstrap integration; product storage locations, GPUI, and media workflows remain deferred.

Intent discovery was deferred at the user's request so bootstrap could proceed. The current intent snapshot and its confirmation state are maintained in the independent local `project-doc` repository.

## Using the foundation

Call async store/core APIs from an entered **multi-thread Tokio runtime**. The store checks this requirement before opening a connection or starting a transaction. Diesel's default SQLite async adapter uses Tokio blocking tasks and its cancellation guard requires multithread runtime support; the libraries never create their own runtime or connection pool.

Use `Session::open(path)` for an explicit SQLite file or `Session::memory()` for an isolated ephemeral database. Each connection enables foreign keys and a 2-second SQLite busy timeout. The kernel initializes its own version table without claiming SQLite's shared `user_version`; repeat initialization preserves data and rejects unsupported core versions.

Standalone kernel methods commit their unit before returning success. For natural composition, use `Session::transaction` and the kernel's `_in` methods, with domain queries using `Context::connection()`:

```rust,ignore
let participant = kernel.clone();
session.transaction::<_, CoreError, _>(move |context| Box::pin(async move {
    let entity = participant.create_entity_in(context).await?;
    // A real domain creates its payload here, using this same context.
    // Then admit its ComponentId, and attach it, through participant *_in APIs.
    Ok(entity)
})).await?;
```

Participating results are provisional until the outer transaction succeeds. Propagate a required failure to roll back the group; independent earlier commits remain durable. Writes use `BEGIN IMMEDIATE`, including the guard, owner evidence, payload deletion, and metadata removal. A deletion savepoint also prevents partial payload changes if an owner fails and its caller catches that error.

Register one `KindOwner` per stable `KindId`. Owners check actual payload existence and perform domain-constrained deletion; duplicate registration is rejected. Owners remain responsible for payload semantics and domain references. The raw Diesel context is a trusted capability: participants must use it, preserve constraints, leave transaction control to the store, and route deletion of admitted components through the guarded core facade. It is not an isolation boundary against a misbehaving owner.

An entity has at most one component per kind; a component can be shared. Identical attachment is recognized, another component in the same slot conflicts, and detach matches the exact intended membership. Detach and entity deletion retain payloads. Component deletion is rejected while attached and otherwise delegates to the domain. Membership metadata remains readable when an owner is unavailable; payload interpretation is a separate domain operation.

Cancellation discards an in-flight transaction's connection. A discarded session must be replaced; it is never silently reused. Outstanding savepoints prevent committing a canceled participant, even when its caller catches cancellation. Driver work may finish during disposal. Cancellation or failure after a potentially executed commit does **not** prove rollback: `CommitOutcomeUnknown` and canceled commits require checking durable identities before retrying. This foundation provides no automatic recovery/retry service.

## Development

The workspace is validated on Windows with Rust/Cargo 1.97.0 stable MSVC, Rustfmt, Clippy, cargo-nextest 0.9.140, and Just 1.57.0.

```text
just rust-validate
just rust-test-code locus-store
just rust-test-code locus-core
just rust-run
```

`rust-validate` applies Clippy fixes and formatting, then checks lint, all code tests, metadata, dependencies, and the build. Contract tests cover real payload tables, file reopen, constraints, domain vetoes, grouped rollback/cancellation, and deterministically ordered races between separate SQLite connections. Use `just rust-lock` when dependency changes require regenerating the lockfile; all Cargo arguments live in the root `justfile`.

See `rules/implementation.md` for repository implementation guidance.
