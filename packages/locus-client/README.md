# Locus client

The server's registered Rust handlers and transport DTOs produce `openapi.json`.
`openapi-typescript` produces `src/schema.d.ts`; do not edit either generated file.
`src/index.ts` exports the small `openapi-fetch` factory. No credential, discovery,
retry, request-ID replacement or run-ID replacement is built into it.

OpenAPI groups operations by `core`, `file`, `media`, `preferences`, `task` and `server` tags.
The server group owns admission, request recovery and completion envelopes that
combine multiple domains. Grouping does not change paths or generated call types.

```ts
import { createLocusClient } from "@locus/client";

const client = createLocusClient({ origin, runId }, authorizedFetch);
const result = await client.POST("/api/v1/imports", {
  body: { request_id: intentionalSubmissionId, source_path: absoluteLocalPath },
});
if (result.data) {
  const outcome = await client.GET("/api/v1/tasks/{task_id}/outcome", {
    params: { path: { task_id: result.data.task_id } },
  });
}
```

The caller gets origin/run context from the private readiness exchange and grants
authorization for that exact origin. In the future Electron host, credential
injection belongs to the native host. An authorized Node consumer can inject
`fetch`, as `smoke.ts` demonstrates. It must refuse credential-bearing redirects
to other origins. Keep the original request ID and run context when recovering a
lost response. A new intentional business attempt gets a new request ID.

| Route under `/api/v1` | Method | Result |
| --- | --- | --- |
| `/server` | GET | Run identity, admission state and active work count |
| `/imports` | POST | 202 task receipt for a supplied local path |
| `/files/{file_id}` | GET | Direct File metadata; 404 `missing_file` for absent record |
| `/entities` | POST | Direct recoverable entity creation (`request_id`) |
| `/entities` | GET | Complete packed binary Entity identities, including empty Entities |
| `/memberships/read` | POST | Attributed current membership batch for `entity_ids`, including duplicates |
| `/media` | POST | Direct recoverable Image/Video creation (`request_id`, `kind`) |
| `/memberships/attach`, `/memberships/detach` | POST | Direct recoverable exact membership mutation |
| `/entities/{entity_id}/memberships` | GET | Direct current memberships |
| `/entities/{entity_id}/view-preference` | GET | Attributed saved definition, unset preference or missing Entity |
| `/entities/{entity_id}/view-preference` | PUT | Direct recoverable conditional preference update |
| `/entities/view-preferences/batch` | POST | Ordered attributed preference results for caller-selected `entity_ids` |
| `/media/{kind}/{component_id}` | GET | Direct retained record, including unattached records |
| `/media/{kind}/{component_id}/view` | GET | Record plus actual-input applicability |
| `/entities/{entity_id}/media` | GET | Independent per-component results, preserving failed entries |
| `/interpretations` | POST | 202 receipt for an explicit attempt against a `target` |
| `/previews` | POST | 202 receipt for an explicit `target` and rendition `edge`, including hits |
| `/files/{file_id}/bytes` | GET/HEAD | Complete original attachment |
| `/previews/{locator}/bytes` | GET/HEAD | Already-produced PNG, with no implicit generation |
| `/requests/{request_id}` | GET | Accepted receipt, direct pending/completion, or retained launch rejection |
| `/tasks` | GET | Complete current public-task snapshot |
| `/tasks/{task_id}` | GET | One current public task |
| `/tasks/{task_id}/outcome` | GET | Pending or retained typed completion |
| `/events` | GET | Snapshot-first SSE stream |
| `/drain` | POST | Idempotently close admission; process exits after accepted work |
| `/openapi.json` | GET | The same generated OpenAPI document |

Every served route requires Bearer authorization and `X-Locus-Run`. OpenAPI
describes the run as a required header parameter, separately from the bearer
grant. The factory supplies it from caller context and adapts only that managed
header out of its per-call type requirements. The generated `paths` remain
unmodified and exported, including the full required header contract.

## Entity presentation preferences

```ts
const observed = await client.GET("/api/v1/entities/{entity_id}/view-preference", {
  params: { path: { entity_id } },
});
if (observed.data?.status === "saved" || observed.data?.status === "unset") {
  const result = await client.PUT("/api/v1/entities/{entity_id}/view-preference", {
    params: { path: { entity_id } },
    body: {
      request_id: intentionalSubmissionId,
      view_definition_id: "image.inspect",
      expected_revision: observed.data.status === "saved" ? observed.data.revision : null,
    },
  });
  // Inspect result.data.status; HTTP 200 alone does not establish a saved choice.
}
```

`saved` supplies the Entity, opaque view-definition ID and positive decimal revision;
`unset` successfully observes no preference, and `missing` identifies an unavailable
Entity. Failed reads remain errors. Batch reads use `{ entity_ids }`, preserve order
and duplicates, reject the whole batch on observation failure, and share membership
batches' exemption from the generic JSON body ceiling. Consumers select the needed
identities; there is no whole-library preference preload or cross-call snapshot.

Keep revision strings intact; JavaScript numbers cannot represent their full range.
Null or omitted `expected_revision` requires no saved preference. A matching revision
permits one update and advances it even when a definition repeats, so A-to-B-to-A does
not revive A's older revision. `view_preference_saved` returns the committed preference.
`view_preference_conflict` returns the current saved/unset observation and performs no
write; `view_preference_missing` leaves the unavailable Entity untouched. Unknown but
valid view definitions remain retained values. The backend neither selects a fallback
nor changes Components when a view is unavailable.

`failed` includes a typed `DomainDiagnostic`. A preferences/store diagnostic whose
kind is `commit_outcome_unknown` means commit completion could not be established;
`direct_complete` only says that the original operation has a retained outcome.
Recover a lost response through `/requests/{request_id}` or identical re-delivery in
the same run. Recovery returns that original outcome even after later saves, without
reapplying the original value. An authoritative read can establish actual saved state.
Restart reads the database; it must not replay old unconfirmed submissions.

Conditional revisions prevent prepared stale writes from overwriting newer committed
versions. The later UI coordinator must still discard superseded intent and retry only
its current choice against newly observed state, using a new request ID. Automatically
rebasing an obsolete write would defeat this protection. The generated client does
not retry, coordinate renderer autosave, or implement normal-close preparation.

`just server-preference-smoke` uses the generated client against a real process and
temporary library, including concurrent delivery, stale rejection, original-result
recovery, component independence/replacement, and restart persistence. Rust owner and
HTTP tests additionally induce an actual deferred-constraint COMMIT failure and check
its retained uncertainty, plus rollback, corruption, deletion and revision bounds.

## Entity discovery and content reads

```ts
import { createLocusClient, readEntityIds } from "@locus/client";

const client = createLocusClient({ origin, runId }, authorizedFetch);
const identities = await readEntityIds(client, { signal });
const selected = identities.at(0); // UUID string on demand; undefined if empty
if (selected !== undefined) {
  const memberships = await client.POST("/api/v1/memberships/read", {
    body: { entity_ids: [selected] },
  });
  // Inspect each status, then dispatch Kind/Component identities to their owners.
}
const replacement = await readEntityIds(client); // new result; identities stays fixed
```

The exported `EntitySequence` exposes `length`, `byteLength`, `at(position)` and
`indexOf(canonicalUuidV7)`. It owns one private binary buffer; indexed access is
O(1) and identity-position lookup is an O(n) binary scan returning `-1` when absent
or invalid. A second zero-copy view compares four words per ID. No million-item
string/object map or auxiliary identity index is built.
Enumeration has no business sort or order-stability guarantee across refreshes.
An existing sequence remains unchanged after domain writes or a failed refresh.

The helper uses the generated GET route and the supplied client, preserving injected
authorization/run headers. It waits for the complete body and validates HTTP 200,
binary media type, required exact decimal Content-Length, byte equality, 16-byte
alignment and RFC UUIDv7 version/variant. It also handles the fetch library's
zero-length parse bypass. HTTP/validation failures throw `EntityReadError`, with
`response` and the generated `apiError` when available; fetch/stream failures reject
without publishing a partial sequence. Empty success is a validated zero-byte body.

The raw generated route is also available:

```ts
const raw = await client.GET("/api/v1/entities", { parseAs: "arrayBuffer" });
// raw.response and raw.error remain available. For Content-Length: 0,
// openapi-fetch can leave raw.data undefined; readEntityIds handles that case.
```

A raw ArrayBuffer alone is not an established identity result; callers bypassing
the helper own equivalent completion and identity validation. JSON batch results
preserve one outcome per input position, in order, including duplicates. `present`
contains `entity_id` and `memberships` (possibly empty); `missing` identifies an
absent Entity. Overall storage/decode failure is an error, never a successful empty
batch. SQL parameter chunking is internal. This route alone has no generic 16 KiB
JSON body ceiling or public item quota; consumers choose the subset they need.

Membership reads do not depend on available provider transports or readable payloads.
Use the returned Kind/Component identities for File/Media/provider calls. Retain
independently successful facts when another component read fails. Reads after
membership discovery use the owner's actual current context, with no cross-call
snapshot. They never start interpretation, preview work or provider refresh.

Transport errors use `ApiError`: 400 invalid input; 401 authorization; 403 foreign
origin/host or denied byte access; 409 wrong run or conflicting request; 404 unknown request/task,
missing File/bytes, unavailable preview, or route; 405 unsupported method; 503 closed admission
or definite launch rejection; 500 direct operation failure. Malformed JSON and
oversized import bodies produce 400 before claiming work. An accepted import may
finish with `TaskOutcome.status = "failed"` despite a successful HTTP query:
inspect its diagnostic and optional known copy progress. Executor failures may
have no progress; this is unknown information, not zero work or proof of rollback.
`commit_outcome_unknown` preserves the existing store/domain uncertainty. File
identities and relative locations remain available on admission failure when known.

Creation and attachment are independent committed operations. File metadata includes
its domain-owned `kind_id`; Media creation returns its `target` and `kind_id`.
Use those values when composing memberships. Exact detach returns `removed: false`
for a stale membership and cannot remove a replacement. A new attach submission
can return `already_attached`; repeated delivery of the original request returns
its original outcome. IDs are bound across every mutation/task endpoint family.
Ordinary reads have no request binding or public task entry.

Direct recovery returns `direct_pending` or `direct_complete` with a
`MutationOutcome`, including typed failure. A lost HTTP response never cancels
accepted work. Interpretation completion is `interpreted` with an accepted record
or context/newer-attempt rejection. An accepted record's `last_failure` may be
non-null and old facts/basis may remain: task completion does not prove decoding
success. `media_failed` retains nested domain errors and commit uncertainty.
`ImportOutcome` remains a compatibility alias of the extended `TaskOutcome` union.

A preview task returns actual `file_id`, kind, edge, stream selection, Hit/Generated
origin and a run-scoped opaque `locator`. A prior F1 result stays F1 after the host
changes to F2. The locator does not pin cache bytes; a 404 `preview_unavailable`
after eviction or restart does not undo its task result. New generation is explicit.
GET/HEAD open controlled bytes through File/Media without holding a database stage
during transfer. Originals are `application/octet-stream` attachments; previews are
`image/png`. Both use `nosniff` and `no-store`, actual opened-file Content-Length,
and no body on HEAD. Range is ignored (200 with the complete representation).
Late read failure or premature EOF fails the transfer.

```ts
const bytes = await client.GET("/api/v1/previews/{locator}/bytes", {
  params: { path: { locator: preview.locator } },
  parseAs: "arrayBuffer",
});
```

Task/request state lasts through this backend run only. Admission has no fixed
request-count or active-operation quota, and recovery bindings remain available
throughout the run. Existing binding lookup precedes the drain gate. A wrong run
or unknown task after restart does not prove absent durable effects. File records
persist; tasks are neither replayed nor reconstructed.

SSE is a `text/event-stream` response, not one JSON `TaskSnapshot`. Each `snapshot`
event has a decimal revision in `id` and complete `TaskSnapshot` JSON in `data`.
Use fetch streaming with the authorization/run headers (or future host header
injection); native browser `EventSource` cannot set those headers by itself.
The exported `TaskSnapshot` type describes the event payload. This package does
not supply a reconnect/revision reducer: consumers must replace their baseline on
reconnect and reject obsolete revisions within the run, comparing with `BigInt`.
Updates can be coalesced; every event is a full replacement, so slow clients do not
need missed deltas. A terminal task always has an immediately queryable outcome.
Drain ends passive streams after accepted work completes; observers cannot keep
the process alive. Public cancellation is not supplied.

From the repository root:

```text
just client-install
just client-generate
just client-check
just client-test
just client-drift
just server-smoke
just server-media-smoke
just server-video-smoke
just server-entity-smoke
just server-entity-scale
```

`client-check` compiles the actual smoke consumer and negative type cases.
`client-drift` exports twice and compares temporary regeneration to checked-in
outputs without rewriting them. `server-smoke` launches the real debug binary
with private anonymous pipes and fresh credentials, exercises successful and
failed File imports, same-run recovery/SSE, restart persistence and passive-client
drain, then deletes only its isolated temporary fixture directory. Its timing
report uses 100 warm JSON requests and states median/p95 plus responsiveness
during a 128 MiB copy. It is a local bounded sample, not a throughput guarantee.

`server-media-smoke` uses a generated PNG and deliberately unavailable video tools
to prove Image independence. `server-video-smoke` invokes configured ffprobe/ffmpeg
directly, creates a synthetic video and runs the same HTTP sequence. Missing tools
fail this explicit check; set `LOCUS_FFPROBE` and `LOCUS_FFMPEG` when they are not on
PATH. Both checks decode returned PNG pixels, compare original bytes, verify
recovery/restart, and drain with unread original bytes and SSE connections.

`server-entity-smoke` checks empty/nonempty/refresh identities, attributed membership
batches and observed-kind dispatch to File/Media. It verifies no read-generated
tasks/cache outputs, then explicitly changes payload/context between steps to show
that earlier successful evidence remains distinct from current domain outcomes.

`server-entity-scale [count]` defaults to 1,000,000 actual valid Entity rows. It
initializes a temporary real library, stops the initializer, seeds constrained rows
with `uv run python`, and starts a fresh measured server. It reports total DB rows
separately from Entity count, complete-result latency including DB decoding and
fetch copies/validation, indexed and linear lookup timings, and actual OS/server
and Node/client memory. A separate compact-bitset check verifies complete unique
fixture coverage outside the timed read. The command has no default-library path.

The server uses the pinned SQLite wrapper's supported blocking callback to iterate
rows directly into an exactly preallocated byte buffer within one transaction;
its default async row collector is avoided. The client adopts the received buffer,
but fetch still allocates/copies during transfer. Memory output includes Node RSS,
heap/external/ArrayBuffer samples and process RSS high-water, plus server working-set
baseline/high-water on Windows or RSS on Linux. Samples can miss synchronous peaks;
high-water figures include process startup. These overlapping values must not be
summed. Other platforms explicitly report a sampled server RSS rather than a peak.

One local 1,000,000-Entity run (Windows 11 x64, i7-14790F, 32 GiB RAM, Node 24.18.0,
Cargo dev profile with optimization/debug info and warm fixture filesystem) had
1,000,003 total DB rows, 16,000,000 ID bytes and a 301 ms first usable result.
Server working set was 13.6 MB baseline / 32.3 MB lifetime peak. Client RSS was
88.7 MB baseline / 140.7 MB observed high-water / 107.7 MB after checks, two event-loop
turns and GC; retained ArrayBuffers were 16.2 MB. Indexed access averaged 0.247
microseconds over 10,000 calls; midpoint/last identity scans took 5.1/5.9 ms. These decimal-MB
measurements include runtime/transport overhead and are a local sample, not a
throughput target, unlimited-size claim or SLA. Rerun the command on the target
machine/build to assess its actual costs.
