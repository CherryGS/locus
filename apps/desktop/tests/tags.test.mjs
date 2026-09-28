import assert from "node:assert/strict"
import { test } from "node:test"
import { TagCoordinator } from "../src/renderer/features/tags/model/tag-coordinator.ts"
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
test("lost delivery retains frozen subject/arguments across close and recovers original request", async () => {
  const lost = deferred(),
    effects = [],
    sent = []
  let observed
  const c = new TagCoordinator(
    {
      tags: async () => [],
      tagWrite: async (input) => {
        sent.push(input)
        return lost.promise
      },
      submission: async (id) => {
        observed = id
        return {
          status: "direct_complete",
          outcome: { status: "tag_assignment", entity_id: "old", tag_id: "tag", changed: true },
        }
      },
    },
    "run",
    (ids) => effects.push(ids),
  )
  const change = { operation: "add", entity_id: "old", tag_id: "tag" }
  const pending = c.write(change, "add")
  change.entity_id = "new"
  c.close()
  lost.reject(new Error("connection lost"))
  await pending
  assert.equal(c.unresolved.length, 1)
  assert.equal(sent[0].change.entity_id, "old")
  await c.recover(c.unresolved[0])
  assert.equal(observed, sent[0].request_id)
  assert.equal(sent.length, 1)
  assert.deepEqual(effects, [["old"]])
  assert.equal(c.attempts[0].state, "confirmed")
})
test("confirmed write stays confirmed after metadata read fails; new run disposes late delivery", async () => {
  const pending = deferred()
  let effects = 0
  const c = new TagCoordinator(
    {
      tags: async () => {
        throw new Error("read failed")
      },
      tagWrite: async () => ({ status: "tag_saved", tag: { id: "tag", name: "cat", revision: "one" } }),
    },
    "run",
    () => effects++,
  )
  await c.write({ operation: "create", name: "cat" }, "create")
  await new Promise((r) => setImmediate(r))
  assert.equal(c.attempts[0].state, "confirmed")
  assert.match(c.readError, /read failed/)
  assert.equal(effects, 1)
  const other = new TagCoordinator({ tagWrite: () => pending.promise }, "old", () => effects++)
  const writing = other.write({ operation: "create", name: "old" }, "create")
  other.dispose()
  pending.resolve({ status: "tag_saved", tag: {} })
  await writing
  assert.equal(effects, 1)
  assert.equal(other.attempts.length, 0)
})
test("uncertain commit remains uncertain even when original outcome and current state are observed", async () => {
  const outcome = { status: "tag_failed", reason: "storage", message: "commit unknown", uncertain: true }
  let writes = 0
  const c = new TagCoordinator(
    {
      tags: async () => [{ id: "tag", name: "cat", revision: "one" }],
      tagWrite: async () => {
        writes++
        return outcome
      },
      submission: async () => ({ status: "direct_complete", outcome }),
    },
    "run",
    () => {},
  )
  await c.write({ operation: "create", name: "cat" }, "create")
  await c.recover(c.unresolved[0])
  assert.equal(c.unresolved.length, 1)
  assert.equal(writes, 1)
  assert.equal(c.unresolved[0].uncertain, true)
  c.host(true)
  await c.write({ operation: "create", name: "blocked" }, "create")
  assert.equal(writes, 1)
})

test("unknown request recovery redelivers frozen arguments with the same identity", async () => {
  const { ApiFailure } = await import("../src/renderer/shared/api/backend-api.ts")
  const calls = []
  const c = new TagCoordinator(
    {
      tags: async () => [],
      tagWrite: async (input) => {
        calls.push(input)
        if (calls.length === 1) throw new Error("never delivered")
        return { status: "tag_saved", tag: { id: "tag", name: "cat", revision: "one" } }
      },
      submission: async () => {
        throw new ApiFailure({ code: "unknown_request", message: "unknown" }, 404)
      },
    },
    "run",
    () => {},
  )
  await c.write({ operation: "create", name: "cat" }, "create")
  await c.recover(c.unresolved[0])
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], calls[1])
  assert.equal(c.attempts[0].state, "confirmed")
})

test("Tag-set reads retain qualified observations and drop assignments after authoritative detach", async () => {
  const { EntityReader } = await import("../src/renderer/entities/entity/model/entity-reader.ts")
  const { setImmediate: turn } = await import("node:timers/promises")
  let attached = true,
    fail = false,
    reads = 0
  const api = {
    memberships: async () => [
      {
        status: "present",
        entity_id: "a",
        memberships: attached
          ? [{ entity_id: "a", component_id: "set", kind_id: "8e880c8b-c7dd-4d6b-b739-a6896c716af1" }]
          : [],
      },
    ],
    tagSet: async () => {
      reads++
      if (fail) throw new Error("Tag-set read unavailable")
      return { component_id: "set", tags: [{ id: "cat", name: "cat", revision: "one" }] }
    },
  }
  const reader = new EntityReader(api)
  reader.demand(["a"])
  await turn()
  await turn()
  assert.equal(reader.get("a").components[0].record.tags[0].name, "cat")
  fail = true
  reader.tagEffects()
  await turn()
  await turn()
  assert.equal(reader.get("a").components[0].previous, true)
  assert.equal(reader.get("a").components[0].readStatus, "failed")
  assert.equal(reader.get("a").components[0].record.tags[0].id, "cat")
  attached = false
  await reader.reread("a")
  await turn()
  assert.equal(reader.get("a").components.length, 0)
  assert.equal(reads, 2)
})
test("mismatched assignment completion cannot confirm another subject and failed recovery remains retryable", async () => {
  let reads = 0
  const c = new TagCoordinator(
    {
      tagWrite: async () => ({
        status: "tag_assignment",
        entity_id: "other",
        tag_id: "tag",
        changed: true,
      }),
      submission: async () => {
        reads++
        throw new Error("offline")
      },
    },
    "run",
    () => assert.fail("unconfirmed response cannot invalidate as known success"),
  )
  await c.write({ operation: "add", entity_id: "original", tag_id: "tag" }, "add")
  assert.equal(c.unresolved.length, 1)
  await c.recover(c.unresolved[0])
  await c.recover(c.unresolved[0])
  assert.equal(reads, 2)
  assert.equal(c.unresolved.length, 1)
})
