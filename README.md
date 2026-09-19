# Locus

A personal local CMS intended to unify management of media, AI model weights, AIGC metadata, relationships, and commonly used Sources.

The Rust workspace contains persistent identity, attachment, managed File, Image and Video backends:

- `locus-store` owns domain-neutral SQLite sessions and transaction boundaries through Diesel 2.3.13 and diesel-async 0.9.2, with bundled SQLite linkage.
- `locus-core` owns UUIDv7 entity/component identities, stable assigned kind IDs, owner-verified component admission, exclusive membership, and guarded lifecycle operations. Domain payloads stay in domain-owned tables.
- `locus-file` owns UUIDv7 File records, managed copies, identified input access, and current entity/File input comparison.
- `locus-media` owns separate Image/Video kinds, retained interpretations and warnings, explicit retry, derived previews/covers, and a common per-component read view.
- `apps/locus` owns the native GPUI Kit shell and separate File/Media backend examples. The default shell uses in-memory fixtures; examples own a multithread Tokio runtime and initialize persistent kernel/File/Media storage.

Intent discovery was deferred at the user's request so bootstrap could proceed. The current intent snapshot and its confirmation state are maintained in the independent local `project-doc` repository.

## Native UI preview

Run `just rust-run` to open the native window. The left navigation, search, status filter and sorting combine to select resources in the center grid or list. The right inspector separates common information and library issues, individually collapsible component panels, and editable notes/tags. Press Enter or use Add to create a tag; click a tag to remove it. Notes, unfinished tag drafts and favorites remain associated with each resource while switching selections, but are cleared when the app closes. Drag the column dividers to adjust widths.

The preview includes six original embedded SVG illustrations and bundled GPUI Kit icons, so it needs no network access or media directory. It does not scan files, download models, persist edits or register domain kinds. Displayed file paths and metadata are illustrative fixtures, not real files or settled schemas. The future GPUI/Tokio/database integration remains unverified. See [UI reference research](docs/ui-shell-research.md) for the source patterns behind the shell.

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

An entity has at most one component per kind; a component has at most one entity attachment. Identical attachment is recognized, another component in the same slot or an existing attachment to another entity conflicts, and detach matches the exact intended membership. Detach and entity deletion retain payloads. Component deletion is rejected while attached and otherwise delegates to the domain. Membership metadata remains readable when an owner is unavailable; payload interpretation is a separate domain operation.

Cancellation discards an in-flight transaction's connection. A discarded session must be replaced; it is never silently reused. Outstanding savepoints prevent committing a canceled participant, even when its caller catches cancellation. Driver work may finish during disposal. Cancellation or failure after a potentially executed commit does **not** prove rollback: `CommitOutcomeUnknown` and canceled commits require checking durable identities before retrying. This foundation provides no automatic recovery/retry service.

## Managed files

The backend composition defaults to `%LOCALAPPDATA%\Locus` on Windows (the local data
location plus `Locus` on other platforms). Set `LOCUS_DATA_DIR` to use an isolated
root. `ApplicationStorage::open(root)` accepts an injected root for composition
and tests. It opens `metadata.sqlite`, registers File/Image/Video owners and initializes
their domain-owned schema versions. Run `just rust-run-backend` for the explicit
console example; the default native shell does not open this database. Core schema
2 upgrades unshared version-1 data
atomically; a shared component produces `MigrationSharedComponent` without changing
its data/schema. Resolving such legacy sharing requires an explicit decision.

The File library accepts an explicit root and does not read process environment:

```rust,ignore
let files = FileStorage::new(root).await?;
let mut kernel = Kernel::new();
kernel.register(Arc::new(FileOwner))?;
let mut session = Session::open(files.root().join("metadata.sqlite")).await?;
kernel.initialize(&mut session).await?;
files.initialize(&mut session).await?;
let record = files.admit(&kernel, &mut session, source_path).await?;
let input = files.open(&mut session, record.id).await?;
```

`admit` copies a regular source, preserves the original, and commits a File record
without requiring an entity. Objects use
`object/<last-four-ID-hex-characters>/<complete-lowercase-32-hex-ID>`; records store
that relative location and the copied byte count. Original filenames do not affect
storage paths. New objects use create-new semantics and never overwrite a collision.

For composition, call `prepare` first and retain its opaque `PreparedFile`; then use
`register_in(&kernel, context, &prepared)` inside `Session::transaction`, optionally
creating an entity and attachment there. Registration's savepoint protects both
File payload and core identity even when a caller catches its error. Its success
is provisional until the outer commit. `register` supplies a standalone committed
unit for an existing prepared copy. Tokens are bound to the configured canonical
root, and cannot be constructed from arbitrary paths.

Copies use bounded-memory blocking I/O on the caller's Tokio runtime. Failures from
`prepare`/`admit` carry identity, root/location, confirmed copy progress, and whether
managed bytes may exist. Keep the prepared token when calling registration directly:
rollback, failed or uncertain commit never deletes its bytes. A canceled awaiting
copy task may leave its blocking worker running; that worker never admits a row.
There is no automatic cleanup, deduplication, retry or exactly-once guarantee.

`lookup` / `lookup_in` read only metadata. `open` returns a `FileInput` with `id()`
and blocking `Read`/`Seek`; perform substantial reads on blocking work. Missing rows,
missing bytes, permission denial and other I/O causes are distinct. Later reader
errors propagate through standard I/O while the handle retains its identity.
Corrupt/mismatched paths and existing symlink/junction escapes are rejected. These
checks assume controlled objects are not silently modified; they do not defend
against hostile concurrent filesystem mutation.

`observe_input` reads the kernel's current File slot, distinguishing missing entity,
missing slot and query failure. `observe_input_in` joins an actual transaction for
consumers coordinating an acceptance boundary. `compare_input(basis, observation)`
compares an optional caller-owned basis with current identity; missing basis and
missing current context remain visible together. Observation/comparison do not
probe bytes or change any consumer basis. A prior observation is not a later-commit
certificate. `local_path` also supplies a validated regular managed path, FileId,
and retained open handle for adapters such as external decoders.

Detach and entity deletion retain File records and bytes. The File owner explicitly
vetoes even unmounted component removal until the record/byte removal effects are
selected; this backend publishes no File removal operation.

## Image and Video backend

The application composes `MediaStorage` into the same `metadata.sqlite`. Image
and Video use distinct stable kinds and separate payload tables, with UUIDv7
component IDs and versioned validated JSON. Each may be created unparsed and
attached independently. `read` reads only the retained record; `view` adds actual
host/File applicability, and `entity_view` preserves each supported membership's
independent result or record error. Metadata reads never probe source bytes.

`create_in`, `read_in`, `view_in` and `apply_in` participate in the caller's
transaction. Creation uses a savepoint even when the caller catches rejection.
`prepare` resolves the component's actual host and File slot, then performs byte
inspection outside SQLite's write transaction. Its opaque token holds the observed
component, host/File and revision. `apply` checks those observations inside one
write boundary; changed context or newer attempts reject stale work. Successful
attempts replace facts and basis together. Failed attempts retain prior facts and
basis with a typed diagnostic. `interpret` composes preparation and acceptance;
retry is explicit and uses the same component. Dropped preparation writes nothing;
acceptance retains the store's provisional/cancellation/uncertain-commit rules.
Detached Media can be deleted through the kernel without deleting File, other
kinds, cached artifacts or original files.

Image detects PNG/JPEG/WebP/GIF from content through Rust `image`, retaining format
and intrinsic raster dimensions. Preview generation decodes a still image and
emits PNG; animated Image previews use the initial still. Basic facts may succeed
while pixel decoding fails. Cargo feature unification does not expand the runtime
format allowlist.

Video uses explicitly configured `ffprobe` and `ffmpeg`. It first accepts only a
bounded movie-family BMFF `ftyp` with every brand on the implementation allowlist,
or EBML with WebM/Matroska DocType. AVIF/HEIF/image brands, unknown brands, ordinary
image signatures and legacy MOV without the recognized header fail as unsupported.
The selected demuxer and local-file protocol are forced; MOV external references
stay disabled. The first temporal stream in observed order is selected, excluding
attached pictures, timed thumbnails and still-image dispositions. A codec such
as PNG may encode temporal frames inside a movie. Incomplete properties remain
unknown without selecting a later stream. Duration belongs to the selected video
stream and has unknown precision; container/audio duration never fills it in.
Covers map exactly that stream, disable autorotation, and request its first
decodable frame from the beginning. Missing tools, failed decode, malformed output,
unsupported input, no frame, timeout and resource limits are distinct outcomes.

Default `MediaConfig` budgets are 512 MiB input, 32,768 pixels per known source
dimension, 40 million source pixels, a 320 MB image allocation budget, 8 MiB PNG
output, two concurrent workers/processes, and a 30-second external-process deadline.
Image validates dimensions/pixels and conservative allocation arithmetic before
full decode. Renditions have an edge of 1–2048. Video cover decoding also supplies
FFmpeg's `max_pixels`; known source rasters are checked before extraction. Probe
output is capped at 1 MiB and stderr at 64 KiB; probing analyzes up to 5 MB/5 seconds
with one decoder thread. FFmpeg `max_alloc` limits individual allocations.
These are work budgets, not a hostile-process sandbox or total-memory ceiling.
Running Rust blocking decoders cannot be forcibly canceled; their semaphore permit
is held until completion. External work has an owned supervisor that kills and
awaits its direct child on cancellation, timeout or output overflow. Keep the
application's Tokio runtime alive for cleanup; runtime shutdown is not awaited
request cancellation. No process-tree sandbox or decoder availability guarantee
is implied.

`preview` returns File/kind/rendition/stream evidence and `Hit` or `Generated`.
The flat `media-cache-v1` subtree keys outputs by FileId, kind, size and policy,
including Video stream/frame policy. A small derived stream-selection marker allows
a matching cover hit without source bytes or tools, even before facts are saved.
Cache hits validate the complete PNG within budgets. Misses may inspect/decode but
never save facts or clear warnings. Complete files are published atomically.
`clear_cache` removes this subtree's regular `media-*` and `pending-*` artifacts
after checking boundaries and redirects; it performs no recursive deletion and
preserves metadata, memberships, managed objects and originals. Rebuilding still
requires usable source input and decoders. Checks retain File's assumption against
silent modification; hostile concurrent filesystem replacement is outside scope.

Run the named example from PowerShell using a disposable root when experimenting:

```powershell
$env:LOCUS_DATA_DIR = 'E:\Temp\locus-media-demo'
$env:LOCUS_FFPROBE = 'E:\Library\ffmpeg-essentials\bin\ffprobe.exe'
$env:LOCUS_FFMPEG = 'E:\Library\ffmpeg-essentials\bin\ffmpeg.exe'
just rust-run-media image 'E:\Inputs\photo.png'
just rust-run-media video 'E:\Inputs\clip.mp4'
just rust-test-video
```

The app alone reads these environment variables, defaulting the tools to explicit
program names `ffprobe`/`ffmpeg`. Each example run creates an entity, admits a new
copy, attaches the intended kind, interprets it, requests a 320-pixel preview and
prints actual IDs and separate stage outcomes. Copies and earlier committed stages
remain if later interpretation fails. The regular File example remains usable.
Source persistence/import transport, playback, native UI integration, model and
AIGC behavior are deferred; the default GPUI shell continues using fixtures.

## Development

The workspace is validated on Windows with Rust/Cargo 1.97.0 stable MSVC, Rustfmt, Clippy, cargo-nextest 0.9.140, and Just 1.57.0. The native GPUI Kit build uses the installed Visual C++ toolchain, Windows SDK (10.0.26100.0 on the development host), CMake and Ninja.

```text
just rust-validate
just rust-test-code locus-store
just rust-test-code locus-core
just rust-test-code locus-file
just rust-test-code locus-media
just rust-test-video
just rust-test-code locus --example file-backend
just rust-run
just rust-run-backend
```

`rust-validate` applies Clippy fixes and formatting, then checks lint, all code tests, metadata, dependencies, and the build. Contract tests cover real payload tables, file reopen, constraints, domain vetoes, grouped rollback/cancellation, and deterministically ordered races between separate SQLite connections. External Video integration tests are explicitly ignored by the generic suite and must be run through `rust-test-video` with provisioned tools; they do not silently skip missing tools. Private subprocess fixtures are ignored tests launched by their supervision tests. Use `just rust-lock` for full lockfile regeneration or `just rust-lock-media` for the scoped offline Media resolution; all Cargo arguments live in the root `justfile`.

See `rules/implementation.md` for repository implementation guidance.
