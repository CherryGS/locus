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
| `/requests/{request_id}` | GET | Accepted receipt or definite retained launch rejection |
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
origin/host; 409 wrong run or conflicting request; 404 unknown request/task,
missing File, or route; 405 unsupported method; 429 capacity; 503 closed admission
or definite launch rejection; 500 direct operation failure. Malformed JSON and
oversized import bodies produce 400 before claiming work. An accepted import may
finish with `ImportOutcome.status = "failed"` despite a successful HTTP query:
inspect its diagnostic and optional known copy progress. Executor failures may
have no progress; this is unknown information, not zero work or proof of rollback.
`commit_outcome_unknown` preserves the existing store/domain uncertainty. File
identities and relative locations remain available on admission failure when known.

Task/request state lasts through this backend run only. New admissions are
bounded (default 1,024 retained requests, 64 active operations); recovery bindings
are never evicted to admit later work. Existing binding lookup precedes drain and
capacity checks. A wrong run or unknown task after restart does not prove absent
durable effects. File records persist; tasks are neither replayed nor reconstructed.

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
the process alive. No byte-streaming/media route or public cancellation is supplied.

From the repository root:

```text
just client-install
just client-generate
just client-check
just client-drift
just server-smoke
```

`client-check` compiles the actual smoke consumer and negative type cases.
`client-drift` exports twice and compares temporary regeneration to checked-in
outputs without rewriting them. `server-smoke` launches the real debug binary
with private anonymous pipes and fresh credentials, exercises successful and
failed File imports, same-run recovery/SSE, restart persistence and passive-client
drain, then deletes only its isolated temporary fixture directory. Its timing
report uses 100 warm JSON requests and states median/p95 plus responsiveness
during a 128 MiB copy. It is a local bounded sample, not a throughput guarantee.
