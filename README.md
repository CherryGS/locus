# Locus

A personal local CMS intended to unify management of media, AI model weights, AIGC metadata, relationships, and commonly used Sources.

The Rust workspace contains persistent identity, attachment, managed File, Image/Video and Twitter snapshot backends:

- `locus-task` owns in-memory task observation, typed completion and atomic binary resource stages on the caller's Tokio runtime.
- `locus-store` owns domain-neutral SQLite sessions and transaction boundaries through Diesel 2.3.13 and diesel-async 0.9.2, with bundled SQLite linkage.
- `locus-core` owns UUIDv7 entity/component identities, stable assigned kind IDs, owner-verified component admission, exclusive membership, and guarded lifecycle operations. Domain payloads stay in domain-owned tables.
- `locus-file` owns UUIDv7 File records, managed copies, identified input access, and current entity/File input comparison.
- `locus-media` owns separate Image/Video kinds, retained interpretations and warnings, explicit retry, derived previews/covers, and a common per-component read view.
- `locus-twitter`, under `crates/provider`, owns independent Twitter snapshots, local validation, guarded File association and provider-specific reads.
- `locus-bilibili`, under `crates/provider`, owns independent video-part and cover source snapshots, local validation, guarded File association and Bilibili-specific reads.
- `apps/server` owns the authenticated loopback Axum server, centralized HTTP/OpenAPI contract, and separate File/Media/Twitter/task backend examples. The server composes kernel/File/Media on one task-bound database; examples also exercise Twitter.
- `packages/locus-client` owns generated TypeScript declarations, a small `openapi-fetch` client factory and a validated compact binary Entity reader, with no renderer framework or embedded credential.

Intent discovery was deferred at the user's request so bootstrap could proceed. The current intent snapshot and its confirmation state are maintained in the independent local `project-doc` repository.

## Loopback server

Run `just client-install` and `just server-smoke` for an isolated real-binary demonstration through the generated client. It imports synthetic files, reads metadata, recovers submissions, observes SSE, checks typed failures/restart/drain, and reports a bounded warm loopback latency sample. It never opens the default user library. The GPUI prototype has been removed. Run `just server-media-smoke` for Image and `just server-video-smoke` with provisioned ffprobe/ffmpeg for Video, through PNG and original-byte retrieval. Connected Electron lifecycle, Axum renderer/static delivery, dialogs and Twitter HTTP adaptation remain later work.

`just server-entity-smoke` demonstrates complete binary Entity discovery, refresh,
bounded batch memberships and subsequent File/Media reads. The client keeps IDs
in one binary buffer and materializes selected UUID strings on demand. Results
stay fixed until replaced by a completed refresh; later membership/payload reads
retain their actual current outcomes. `just server-entity-scale` seeds 1,000,000
actual Entities in a temporary library and reports complete-read latency, lookup
costs and measured server/client memory, including transport allocation costs.
Fixture setup requires `uv` and is excluded from the enumeration timing.

`just server-run` (also `just rust-run`) expects a private stdin pipe containing one JSON object followed by EOF: a caller-created random temporary `credential` (32–256 ASCII token characters), and optional absolute `library_root`. The input is limited to 16 KiB. The server binds `127.0.0.1:0`, opens storage, and emits one stdout JSON readiness record with `origin` and fresh `run_id`; diagnostics use stderr. Credentials are never printed, persisted or placed in URLs. The host must create the credential and scope authorization to that exact origin; connected desktop-host integration remains later work.

All routes, including `/api/v1/openapi.json`, require `Authorization: Bearer …` and `X-Locus-Run`. Foreign Origin/Host headers are rejected, with no permissive CORS. Metadata reads use task-bound database coordination and return directly. File imports require a canonical UUID `request_id` and an absolute `source_path`, returning a public task receipt. Same-run identical redelivery recovers the receipt; conflicting arguments fail. Typed outcomes preserve File identity, copy progress, and commit uncertainty. Byte counts, progress units and revisions use exact decimal strings.

Submission bindings and outcomes remain available throughout the run. Admission has no fixed request-count or active-operation quota; domain stages coordinate actual shared resources. Drain atomically closes new work, preserves observation/recovery while accepted tasks, direct mutations and reads complete, then ends passive connections within a one-second flush window. Ctrl-C requests the same sequence. Restart uses a fresh run and does not replay or reconstruct tasks from durable domain records.

Entity and Image/Video creation and exact membership mutations return direct,
committed domain outcomes, retaining pending/completed/failed request recovery
without entries in the public task list. Explicit interpretation and preview
creation always return task receipts, including warnings, failures and cache hits.
An accepted interpretation may retain a failure warning; inspect its result and
record rather than treating task completion as decoding success. Reads never
implicitly interpret or generate. `LOCUS_FFPROBE` / `LOCUS_FFMPEG` override the
application's video tools; missing tools do not block startup, Image or reads.

Authenticated GET/HEAD byte routes stream complete representations. Originals are
`application/octet-stream` attachments and derived previews are `image/png`; both
use `nosniff` and `no-store`. Range is ignored with a normal full response. Derived
locators last only for their backend run, preserve the actual source File and
rendition evidence, and do not pin cache bytes. Eviction returns unavailable;
reading never regenerates. HTTP transfer retains no database stage.

Use `just client-generate` to export OpenAPI and regenerate TypeScript, `just client-check` for positive/negative type checks, and `just client-drift` to verify deterministic checked-in output. Schema export (`just server-schema [path]`) does not open storage or require bootstrap/authentication. See [client and API usage](packages/locus-client/README.md) for routes, error/status behavior and SSE semantics.

`just client-test` exercises full-transfer validation, zero-length success and
malformed/truncated responses through the actual generated-client factory.

HTTP adapters are grouped by the crate they consume inside `apps/server/src/api`:
`core` owns entity/membership endpoints, `file` owns imports and original access,
`media` owns interpretation, contextual Media views and previews, and `task` owns
task observation/SSE. Each group registers its routes beside its handlers. Store
error conversion lives in `store.rs`. Cross-domain completion/error envelopes,
request recovery, admission and shared transport mechanics belong to the server
level. Runtime domain calls follow the same `core`/`file`/`media` ownership;
shared supervision remains in `runtime`. Domain crates stay independent of HTTP.
OpenAPI uses matching `core`, `file`, `media`, `task` and `server` tags; these
groups do not add URL prefixes.

## Desktop shell

Run `just desktop-install`, then `just desktop-run` for the standalone Electron
shell in `apps/desktop`. It provides Home / Entity / Setting routes and an Overview
panel without opening a library or starting the backend. Use `just desktop-check`
and `just desktop-build` to validate it; `just desktop-preview` launches the built
assets. See [desktop development](apps/desktop/README.md) for source boundaries.

## Civitai example media

Civitai enrichment uses the pinned provider-rs `PreviewMedia` API and selects
`preview_image` or `preview_video` from the example's declared type. An absent
type retains the image path; an unsupported declared type fails explicitly.
The discovered URL is preserved. Video downloads must have a video response
type and pass ordinary Media recognition, interpretation and cover generation
before the example is complete. Poster images cannot complete a video example.
Accepted metadata and admitted content survive a failed step for explicit retry.

`just rust-test-code locus-civitai` checks the actual download adapter against an
isolated local HTTPS server, including image/video selection, poster rejection,
HTTP failure and incomplete responses. `just rust-test-civitai-video` uses
provisioned ffprobe/ffmpeg to verify a synthetic video's admission, cover recovery
and shared reuse. Set `LOCUS_FFPROBE` / `LOCUS_FFMPEG` when the tools are not on
PATH. These checks do not contact Civitai or open the user's library.

## Bilibili video sources

`locus-bilibili` retains provider-owned ordinary-video snapshots with separate
submission BVID/AID, selected-part CID/index, title/description, uploader, source
representation and cover observations. Video and submission-cover assets have
separate source roles and independently managed records. Missing optional fields
remain unknown. Snapshots and File associations follow the same guarded lifecycle
as the other Source capabilities; reads do not contact Bilibili.

Registered imports accept a `bilibili` snapshot with an optional registered File
through both the desktop and external receiving APIs. An item selects one provider
snapshot, Twitter or Bilibili. The desktop reads Bilibili cards, content, details,
association diagnostics and import outcomes, alongside ordinary local Image/Video
preview and playback. See the [receiving contract](packages/locus-client/README.md#bilibili-ordinary-video-imports)
for extension integration. Chrome-extension acquisition and delivery are separate.

Run `just rust-test-code locus-bilibili` for domain checks and
`just desktop-bilibili-browser` for real external uploads/imports and desktop
reading of a synthetic video, submission cover and locator-only observation.
The latter requires ffprobe/ffmpeg and uses an isolated library and local browser.

## Using the foundation

All library APIs use a single public `api` module, for example
`locus_core::api::{Kernel, EntityId}`, `locus_store::api::{Session, Context}`,
`locus_file::api::{FileService, FileId}` and
`locus_media::api::{MediaService, MediaConfig}` and
`locus_twitter::api::{TwitterService, TwitterId}`. Internal module layout is private.
Domain IDs, records and errors keep their domain names; the operation entry objects
use the `Service` suffix. Older root imports and `FileStorage`/`MediaStorage` names
are replaced by these paths and names; File record `lookup`/`lookup_in` are now
`read`/`read_in`. This source migration does not require a data migration.

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
and tests. It opens `metadata.sqlite`, registers File/Image/Video/Twitter owners and initializes
their domain-owned schema versions. Run `just rust-run-backend` for the explicit
console example; the server initializes its consumed kernel/File/Media schemas. Core schema
2 upgrades unshared version-1 data
atomically; a shared component produces `MigrationSharedComponent` without changing
its data/schema. Resolving such legacy sharing requires an explicit decision.

The File library accepts an explicit root and does not read process environment:

```rust,ignore
use locus_core::api::Kernel;
use locus_file::api::{FileOwner, FileService};
use locus_store::api::Session;
use std::sync::Arc;

let files = FileService::new(root).await?;
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

`read` / `read_in` read only metadata. `open` returns a `FileInput` with `id()`
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

The application composes `MediaService` into the same `metadata.sqlite`. Image
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
Extension delivery/import transport, playback, native UI integration, model and
AIGC behavior remain deferred.

## Twitter provider backend

`crates/provider/locus-twitter` is an independent provider package. It consumes
core, File and store; Media is not a production dependency. Provider directories
are simple workspace organization. There is no common Source crate or read DTO.

`TwitterService` persists one submitted snapshot per `TwitterId`, with a stable
`TWITTER_KIND` shared by image and video captures. Post/media IDs are external
locators; identical locators do not merge local components. Snapshot fields keep
post context, the selected media occurrence, its chosen representation and remote
preview separate. These are submitted claims, not intrinsic Media facts or proof
of remote authenticity. Missing optional values remain missing; an observed empty
string or list remains distinct from information not captured. Producer-reported
capture issues do not erase unrelated valid observations.

Local validation accepts positive canonical decimal `u64` post/user/media IDs.
Post URLs use HTTP(S), an `x.com` or `twitter.com` host (including `www`, `mobile`
and `m` aliases), and `/<handle>/status/<id>`, `/i/status/<id>` or
`/i/web/status/<id>`, optionally with `/photo/<index>` or `/video/<index>`.
Supplied subject ID and page URL must agree; a URL suffix does not populate the
occurrence fields. Requested and descriptive resource URLs remain separate
HTTP(S) claims. Credentials, whitespace/controls and backslashes in URLs are
rejected; URLs also require explicit `http://` or `https://` and valid percent
escapes. Original supplied strings are retained after validation.

UTF-8 limits are 64 KiB per text field, 1 KiB per label, 8 KiB per URL and 128
entries per collection. A snapshot reserves 256 bytes below the 256 KiB persisted
payload limit for its version and File basis. Oversized submissions are rejected
without truncation. Handles use 1–15 ASCII letters, digits or underscores;
publication/observation times use nonnegative Unix milliseconds through year 9999.
Known dimensions and bitrates must be positive; duration may be zero. Duration
and bitrate must fit `i64`; MIME claims use type/subtype without parameters.
These are this backend's accepted representations, not remote-state verification.

`create` / `create_in` validate and save a snapshot without requiring a File or
entity; payload creation and core admission share a savepoint. `read` / `read_in`
return retained data. Explicit replacement preserves the component ID, checks the
expected revision, replaces the whole observation and clears its previous File
basis. Invalid or stale writes preserve the accepted state.

`prepare_association` observes the intended snapshot revision, actual host and
caller-named current File. Its opaque token is accepted only after those facts and
the File record are checked again inside the write transaction. Association and
combined replacement/association keep snapshot, basis and revision consistent.
Successful `_in` operations remain provisional until their caller commits.
Independent commits survive later failures; there is no automatic retry or cleanup.

Provider views retain the snapshot while describing unassociated, missing or
changed input and observation errors. Reads and association do not probe bytes,
contact Twitter, refresh captures or adopt a later File automatically. A matching
File identity does not certify readable bytes, successful Media parsing or source
authenticity. Detached Twitter components can be deleted through the guarded
kernel; that deletes only their own records and does not pin or remove File data.

The local example accepts a post ID/URL and an optional local file. Use an isolated
root when experimenting:

```powershell
$env:LOCUS_DATA_DIR = 'E:\Temp\locus-twitter-demo'
just rust-run-twitter '1234567890123456789'
just rust-run-twitter 'https://x.com/example/status/1234567890123456789' 'E:\Inputs\clip.mp4'
```

The example prints committed entity/Source IDs before optional File admission and
association. A failed File step returns an error while the printed Source record
remains saved. This consumer uses supplied observations and bytes; the Chrome
extension receiving protocol and full import workflow remain separate work.

## In-memory task backend

Run `just rust-run-tasks` for the real `task-backend` consumer. It creates a
temporary library and synthetic PNG, runs two independent File/Image/Twitter
operations, prints waiting/running stages and live progress, then retrieves typed
File, interpretation, preview and snapshot results. It does not open user data or
use the server HTTP surface. The temporary library is removed on exit.

Compose `locus_task::api::TaskQueue` with `locus_store::api::TaskDatabase::open`.
Within each submitted body, obtain `database.session(&task)` and call the ordinary
domain APIs. Canonical configured paths in the same queue share one DB resource,
even across independent capabilities/connections. Each `TaskDatabase::memory`
call creates a distinct database. Standalone `Session` remains available and
does not participate in queue exclusion; hard-link aliases and external processes
are outside this cooperative identity scope.

Store acquires the DB stage before BEGIN and holds it through commit/rollback or
discarded connection disposition. `_in` calls and savepoints reuse that context.
File copy/access and Media inspection/preview stages run outside DB transactions;
existing Media execution limits remain decoder details. Explicit preparation
without a Session can use `FileService::prepare_task(&task, path)`.

For other resource owners, `TaskContext::enter` admits a deduplicated complete
resource set; empty sets are valid. Nested acquisition and foreign resources
return errors. Submitted eligible continuations take preference over fresh work,
without reserving future needs or promising starvation freedom. Owned work uses
`TaskContext::run` or the Stage worker helpers so its lease follows actual workers.
`run` returns after all leases for that stage are released, so the next stage can
start immediately; operation results must not retain a Stage guard.
Borrowed stages require protected objects to be dropped before their guard.

Dropping a task handle stops observation only. Its typed result is retained until
consumed/dropped, and task completion waits for outstanding stage leases. Snapshot
`Completed` describes operation completion, including a returned domain rejection,
warning or error; inspect the typed result for its meaning. Observation is
coalesced, totals can be unknown, and no durable task journal, replay, public task
cancellation or application shutdown protocol is provided. Keep the owning
runtime alive until work finishes.

Use `just rust-test-code locus-task` for scheduler/lifetime tests and
`just rust-lock-tasks` to resolve the task workspace edges offline without changing
the selected external versions.

## Development

The workspace is validated on Windows with Rust/Cargo 1.97.0 stable MSVC, Rustfmt, Clippy, cargo-nextest 0.9.140, and Just 1.57.0. The Windows build uses the installed Visual C++ toolchain and bundled SQLite.

Build profiles are set in the workspace root. `dev` uses optimization level 1,
line-table debug information, assertions/overflow checks and incremental builds;
non-workspace dependencies use optimization level 3 without debug information.
`release` uses thin LTO with 8 codegen units. `dist` inherits release and uses one
codegen unit. Both retain line-table debug information and unwind panics without
stripping symbols. The default `just rust-run` uses the development profile.
Use `just rust-build-release` or `just rust-build-dist` for the application binary;
the latter writes to `target/dist`. A changed profile can rebuild dependencies.

```text
just rust-validate
just rust-test-code locus-store
just rust-test-code locus-core
just rust-test-code locus-file
just rust-test-code locus-media
just rust-test-code locus-twitter
just rust-test-video
just rust-test-code locus-server --example file-backend
just rust-run
just rust-run-backend
```

`rust-validate` applies Clippy fixes and formatting, then checks lint, all code tests, metadata, dependencies, and the build. Contract tests cover real payload tables, file reopen, constraints, domain vetoes, grouped rollback/cancellation, and deterministically ordered races between separate SQLite connections. External Video integration tests are explicitly ignored by the generic suite and must be run through `rust-test-video` with provisioned tools; they do not silently skip missing tools. Private subprocess fixtures are ignored tests launched by their supervision tests. Use `just rust-lock` for full lockfile regeneration or `just rust-lock-media` for the scoped offline Media resolution; all Cargo arguments live in the root `justfile`.

See `rules/implementation.md` for repository implementation guidance.
