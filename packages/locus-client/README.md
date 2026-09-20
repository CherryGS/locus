# Locus client

The server's registered Rust handlers and transport DTOs produce `openapi.json`.
`openapi-typescript` produces `src/schema.d.ts`; do not edit either generated file.
`src/index.ts` supplies the small `openapi-fetch` factory. No credential, discovery,
retry, request-ID replacement or run-ID replacement is built into it.

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
| `/media` | POST | Direct recoverable Image/Video creation (`request_id`, `kind`) |
| `/memberships/attach`, `/memberships/detach` | POST | Direct recoverable exact membership mutation |
| `/entities/{entity_id}/memberships` | GET | Direct current memberships |
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
just client-drift
just server-smoke
just server-media-smoke
just server-video-smoke
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
