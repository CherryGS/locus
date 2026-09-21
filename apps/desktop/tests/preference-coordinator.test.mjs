import assert from "node:assert/strict"
import { test } from "node:test"
import { setImmediate as turn } from "node:timers/promises"
import { PreferenceCoordinator } from "../src/renderer/features/entity-view-preferences/model/preference-coordinator.ts"
import { ApiFailure, BackendApi, commitUnknown, diagnosticText } from "../src/renderer/shared/api/backend-api.ts"

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const tick = async () => {
  await turn()
  await turn()
}
const saved = (entityId, view, revision = "1") => ({
  status: "view_preference_saved",
  preference: { entity_id: entityId, view_definition_id: view, revision },
})
function fixture(overrides = {}, capacity = 256) {
  const writes = []
  let request = 0
  const api = {
    preferences: async (ids) => ids.map((entity_id) => ({ status: "unset", entity_id })),
    savePreference: async (id, body) => {
      writes.push({ id, body })
      return saved(id, body.view_definition_id)
    },
    submission: async () => ({ status: "direct_pending" }),
    ...overrides,
  }
  return { api, writes, coordinator: new PreferenceCoordinator(api, () => `request-${++request}`, capacity) }
}
test("explicit choice during initial read remains pending, autosaves, and close waits for it", async () => {
  const read = deferred(),
    write = deferred()
  let body
  const { coordinator } = fixture({
    preferences: () => read.promise,
    savePreference: (_id, value) => {
      body = value
      return write.promise
    },
  })
  coordinator.demand(["a"])
  coordinator.choose("a", "file.info")
  assert.equal(coordinator.get("a").status, "saving")
  assert.deepEqual(coordinator.problems("a"), [])
  let prepared = false
  const close = coordinator.prepare().then((value) => {
    prepared = true
    return value
  })
  await tick()
  assert.equal(prepared, false)
  read.resolve([{ status: "unset", entity_id: "a" }])
  await tick()
  assert.equal(body.view_definition_id, "file.info")
  assert.equal(body.expected_revision, null)
  assert.equal(prepared, false)
  write.resolve(saved("a", "file.info"))
  assert.deepEqual((await close).items, [])
})
test("A to B to A retains intent and orders a rapid later choice behind the original write", async () => {
  const first = deferred(),
    second = deferred(),
    writes = []
  const { coordinator } = fixture({
    savePreference: (id, body) => {
      writes.push({ id, body })
      return writes.length === 1 ? first.promise : second.promise
    },
  })
  await coordinator.read(["a", "b"])
  coordinator.choose("a", "image.inspect")
  await tick()
  coordinator.demand(["b"])
  coordinator.choose("a", "file.info")
  coordinator.demand(["a"])
  assert.equal(writes.length, 1)
  assert.equal(coordinator.get("a").intended, "file.info")
  first.resolve(saved("a", "image.inspect", "9007199254740993"))
  await tick()
  assert.equal(writes.length, 2)
  assert.notEqual(writes[0].body.request_id, writes[1].body.request_id)
  assert.equal(writes[1].body.expected_revision, "9007199254740993")
  assert.equal(coordinator.get("a").status, "saving")
  assert.deepEqual(coordinator.problems("a"), [])
  second.resolve(saved("a", "file.info", "9007199254740994"))
  await tick()
  assert.equal(coordinator.get("a").status, "saved")
  assert.equal(coordinator.get("b").intended, undefined)
})
test("late read rejection cannot downgrade a newer confirmed save", async () => {
  const read = deferred()
  const { coordinator, api } = fixture()
  await coordinator.read(["a"])
  api.preferences = () => read.promise
  const refresh = coordinator.read(["a"])
  coordinator.choose("a", "file.info")
  await tick()
  read.reject(new Error("old read failed"))
  await refresh
  assert.equal(coordinator.get("a").status, "saved")
  assert.deepEqual(coordinator.problems("a"), [])
})
for (const outcome of [
  {
    status: "view_preference_conflict",
    current: { status: "saved", entity_id: "a", view_definition_id: "future.view", revision: "7" },
  },
  { status: "view_preference_missing", entity_id: "a" },
]) {
  test(`settled older read clears pending after ${outcome.status} without replacing its observation`, async () => {
    const read = deferred()
    const { coordinator, api } = fixture({ savePreference: async () => outcome })
    await coordinator.read(["a"])
    api.preferences = () => read.promise
    const refresh = coordinator.read(["a"])
    coordinator.choose("a", "file.info")
    await tick()
    const observation = coordinator.get("a").observation
    const problems = coordinator.problems("a")
    assert.equal(coordinator.get("a").readPending, true)
    read.reject(new Error("superseded read failed"))
    await refresh
    assert.equal(coordinator.get("a").readPending, false)
    assert.strictEqual(coordinator.get("a").observation, observation)
    assert.deepEqual(coordinator.problems("a"), problems)
    assert.equal(coordinator.get("a").readProblem, undefined)
    assert.equal(coordinator.get("a").intended, "file.info")
    assert.equal(coordinator.get("a").status, "unsaved")
  })
}
test("current conflict waits for retry; a superseded conflict submits only the newer intent on observed basis", async () => {
  const conflict = deferred(),
    writes = []
  const { coordinator } = fixture({
    savePreference: async (id, body) => {
      writes.push(body)
      return writes.length === 1 ? conflict.promise : saved(id, body.view_definition_id, "8")
    },
  })
  await coordinator.read(["a"])
  coordinator.choose("a", "image.inspect")
  await tick()
  coordinator.choose("a", "file.info")
  conflict.resolve({
    status: "view_preference_conflict",
    current: { status: "saved", entity_id: "a", view_definition_id: "future.view", revision: "7" },
  })
  await tick()
  assert.equal(writes.length, 2)
  assert.equal(writes[1].view_definition_id, "file.info")
  assert.equal(writes[1].expected_revision, "7")
  assert.equal(coordinator.get("a").status, "saved")
  const current = fixture({
    savePreference: async () => ({ status: "view_preference_conflict", current: { status: "unset", entity_id: "a" } }),
  }).coordinator
  await current.read(["a"])
  current.choose("a", "file.info")
  await tick()
  assert.equal(current.get("a").status, "unsaved")
  assert.equal(current.pendingChoices().length, 1)
})
test("lost response recovers the same submission; unknown identity redelivers identical body only", async () => {
  const bodies = []
  let lookups = 0
  const { coordinator } = fixture({
    savePreference: async (id, body) => {
      bodies.push(body)
      if (bodies.length === 1) throw new Error("response dropped")
      return saved(id, body.view_definition_id)
    },
    submission: async () => {
      lookups++
      throw new ApiFailure({ code: "unknown_request", message: "Unknown" }, 404)
    },
  })
  await coordinator.read(["a"])
  coordinator.choose("a", "image.inspect")
  await tick()
  assert.equal(lookups, 1)
  assert.equal(bodies.length, 2)
  assert.strictEqual(bodies[0], bodies[1])
  assert.equal(coordinator.get("a").status, "saved")
})
test("pending original blocks newer writes until explicit confirmation recovery", async () => {
  const { coordinator, api } = fixture({
    savePreference: async () => {
      throw new Error("dropped")
    },
  })
  await coordinator.read(["a"])
  coordinator.choose("a", "image.inspect")
  await tick()
  const original = coordinator.get("a").attempt.body
  coordinator.choose("a", "file.info")
  assert.equal(coordinator.get("a").attempt.body, original)
  api.submission = async () => ({ status: "direct_complete", outcome: saved("a", "image.inspect", "3") })
  let current
  api.savePreference = async (id, body) => {
    current = body
    return saved(id, body.view_definition_id, "4")
  }
  await coordinator.recover("a")
  await tick()
  assert.equal(current.view_definition_id, "file.info")
  assert.equal(current.expected_revision, "3")
  assert.notEqual(current.request_id, original.request_id)
})
test("terminal nested commit uncertainty requires actual reread and does not certify through read failure", async () => {
  const diagnostic = {
    owner: "preferences",
    error: {
      code: "core",
      error: { code: "store", diagnostic: { kind: "commit_outcome_unknown", message: "Actual commit uncertainty" } },
    },
  }
  assert.equal(commitUnknown(diagnostic), true)
  assert.match(diagnosticText(diagnostic), /Actual commit uncertainty/)
  let writes = 0
  const { coordinator, api } = fixture({
    savePreference: async () => {
      writes++
      return { status: "failed", diagnostic }
    },
  })
  await coordinator.read(["a"])
  coordinator.choose("a", "file.info")
  await tick()
  assert.equal(coordinator.get("a").status, "unconfirmed")
  assert.equal(coordinator.get("a").attempt, undefined)
  api.preferences = async () => {
    throw new Error("read failed")
  }
  await coordinator.recover("a")
  assert.equal(writes, 1)
  assert.equal(coordinator.pendingChoices().length, 1)
  api.preferences = async () => [{ status: "saved", entity_id: "a", view_definition_id: "file.info", revision: "2" }]
  await coordinator.recover("a")
  assert.equal(coordinator.get("a").status, "saved")
  assert.deepEqual(coordinator.pendingChoices(), [])
})
test("read failure is not unset, missing is not writable, and saved unknown definitions stay retained", async () => {
  const { coordinator, writes, api } = fixture({
    preferences: async () => {
      throw new Error("corrupt preference")
    },
  })
  await coordinator.read(["a"])
  coordinator.choose("a", "file.info")
  await tick()
  assert.equal(writes.length, 0)
  api.preferences = async () => [{ status: "missing", entity_id: "a" }]
  await coordinator.read(["a"])
  assert.equal(writes.length, 0)
  assert.equal(coordinator.get("a").status, "unsaved")
  api.preferences = async () => [{ status: "saved", entity_id: "b", view_definition_id: "future.view", revision: "9" }]
  await coordinator.read(["b"])
  assert.equal(coordinator.get("b").observation.view_definition_id, "future.view")
  assert.equal(writes.length, 0)
})
test("run loss forbids automatic replay; seal rejects new intent and a confirmed return restores saving", async () => {
  const { coordinator, writes } = fixture()
  await coordinator.read(["a"])
  coordinator.choose("a", "file.info")
  await tick()
  const revision = coordinator.intentRevision
  assert.equal(coordinator.seal(revision - 1, false), false)
  assert.equal(coordinator.seal(revision, false), true)
  assert.equal(coordinator.choose("a", "image.inspect"), false)
  coordinator.returnToApplication()
  assert.equal(coordinator.choose("a", "image.inspect"), true)
  await tick()
  coordinator.lost("Backend stopped")
  assert.equal(coordinator.choose("a", "file.info"), false)
  coordinator.retry("a")
  await tick()
  assert.equal(writes.length, 2)
})
test("generated client preserves wire body revision and treats JSON failure as an API failure", async () => {
  const requests = []
  const api = new BackendApi({ origin: "http://127.0.0.1:12345", runId: "run" }, async (request) => {
    requests.push(request)
    return Response.json({ code: "wrong_run", message: "Old run" }, { status: 409 })
  })
  await assert.rejects(
    api.savePreference("a", {
      request_id: "request",
      view_definition_id: "file.info",
      expected_revision: "9007199254740993",
    }),
    ApiFailure
  )
  assert.equal(requests[0].headers.get("X-Locus-Run"), "run")
  assert.equal((await requests[0].json()).expected_revision, "9007199254740993")
})
test("successful empty File bytes remain an actual resource response for the decoder", async () => {
  const api = new BackendApi(
    { origin: "http://127.0.0.1:12345", runId: "run" },
    async () =>
      new Response(null, {
        status: 200,
        headers: { "content-length": "0", "content-type": "application/octet-stream" },
      })
  )
  assert.equal((await api.bytes("file", new AbortController().signal)).size, 0)
})
