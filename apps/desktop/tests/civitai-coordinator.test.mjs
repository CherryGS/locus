import assert from "node:assert/strict"
import { test } from "node:test"
import { CivitaiCoordinator } from "../src/renderer/features/civitai/model/coordinator.ts"
import { ApiFailure } from "../src/renderer/shared/api/backend-api.ts"
const deferred = () => {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}
function setup() {
  const calls = [],
    effects = []
  const api = {
    context: { runId: "run" },
    civitaiOperations: async () => ({ run_id: "run", operations: [] }),
    enrichCivitai: async (body) => {
      calls.push(body)
      return { run_id: "run", request_id: body.request_id, task_id: "task" }
    },
    submission: async (id) => ({
      status: "accepted",
      receipt: { run_id: "run", request_id: id, task_id: "task" },
    }),
  }
  const c = new CivitaiCoordinator(api, (ids) => effects.push(ids))
  c.host({ connection: { status: "ready", runId: "run" }, close: { phase: "idle" } })
  return { c, api, calls, effects }
}
test("accepted request remains blocked when operation observation is lost", async () => {
  const f = setup()
  f.api.civitaiOperations = async () => {
    throw Error("read lost")
  }
  await f.c.submit("entity", "file", true)
  assert(f.c.blocked("entity"))
  assert.equal(f.calls.length, 1)
  await f.c.submit("entity", "file", true)
  assert.equal(f.calls.length, 1)
  f.c.dispose()
})
test("explicit unknown request recovery redelivers the exact original request only when never accepted", async () => {
  const f = setup()
  f.api.enrichCivitai = async (body) => {
    f.calls.push(body)
    throw Error("delivery lost")
  }
  await f.c.submit("entity", "file", true)
  const id = [...f.c.pending.keys()][0]
  f.api.submission = async () => {
    throw new ApiFailure({ code: "unknown_request", message: "unknown" }, 404)
  }
  await f.c.recover(id)
  assert.equal(f.calls.length, 2)
  assert.deepEqual(f.calls[0], f.calls[1])
  f.c.dispose()
})
test("definite rejection unlocks a fresh explicit action", async () => {
  const f = setup()
  f.api.enrichCivitai = async () => {
    throw new ApiFailure({ code: "invalid_request", message: "invalid" }, 400)
  }
  await f.c.submit("entity", "file", true)
  assert(!f.c.blocked("entity"))
  assert.equal(f.c.problem, "invalid")
  f.c.dispose()
})
test("trailing observation catches effects arriving during an older inactive read", async () => {
  const f = setup(),
    held = deferred()
  let reads = 0
  f.api.civitaiOperations = async () =>
    ++reads === 1
      ? held.promise
      : {
          run_id: "run",
          operations: [
            {
              operation_id: "work",
              last_request_id: "request",
              active_request_id: null,
              outcome: {
                entity_id: "entity",
                file_id: "file",
                effect_revision: "2",
                state: "complete",
                examples: [],
              },
            },
          ],
        }
  const first = f.c.observe()
  await f.c.observe()
  held.resolve({ run_id: "run", operations: [] })
  await first
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(reads, 2)
  assert.deepEqual(f.effects, [["entity"]])
  f.c.dispose()
})
test("late response after disposal cannot publish effects", async () => {
  const f = setup(),
    held = deferred()
  f.api.civitaiOperations = () => held.promise
  const read = f.c.observe()
  f.c.dispose()
  held.resolve({
    run_id: "run",
    operations: [
      {
        operation_id: "work",
        outcome: { entity_id: "e", effect_revision: "1", state: "complete", examples: [] },
      },
    ],
  })
  await read
  assert.deepEqual(f.effects, [])
  assert.deepEqual(f.c.operations, [])
})
