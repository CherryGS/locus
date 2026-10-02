import assert from "node:assert/strict"
import { test } from "node:test"
import { setImmediate as turn } from "node:timers/promises"
import { EntityReader } from "../src/renderer/entities/entity/model/entity-reader.ts"
import { entityTagObservation } from "../src/renderer/features/tags/model/entity-tag-observation.ts"

const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
const tick = async () => { await turn(); await turn() }
const tags = (name) => ({ entity_id: "a", tag_set: name ? {
  component_id: "set", tags: [{ id: name, name, revision: "1", parent: null }],
} : null })
function fixture() {
  const calls = { memberships: 0, files: 0, tags: 0 }
  const api = {
    memberships: async (ids) => {
      calls.memberships++
      return ids.map((entity_id) => ({ status: "present", entity_id, memberships: [
        { entity_id, component_id: entity_id, kind_id: "9fd73d3d-d35d-41bc-8b73-402e12f5c017" },
      ] }))
    },
    file: async (id) => {
      calls.files++
      return { file_id: id, kind_id: "9fd73d3d-d35d-41bc-8b73-402e12f5c017", byte_count: "42", relative_path: id }
    },
    entityTags: async () => { calls.tags++; return tags("new") },
  }
  return { api, calls, reader: new EntityReader(api) }
}

test("tag-only refresh preserves other components and resources, including failed refresh and authoritative detach", async () => {
  const { api, calls, reader } = fixture()
  reader.demand(["a"])
  await tick()
  const before = reader.get("a")
  const resource = reader.resourceRevision("a")
  const held = deferred()
  api.entityTags = () => held.promise
  const refreshing = reader.tagEffects(["a"])
  await tick()
  assert.equal(reader.get("a"), before, "No loading-state replacement while refreshing observed tags")
  held.resolve(tags("first"))
  await refreshing
  assert.equal(reader.get("a").components[0], before.components[0])
  assert.equal(reader.get("a").loading, false)
  assert.equal(reader.resourceRevision("a"), resource)
  assert.deepEqual([calls.memberships, calls.files], [1, 1])
  api.entityTags = async () => { throw new Error("offline") }
  await reader.tagEffects(["a"])
  assert.equal(entityTagObservation(reader.get("a")).tags[0].id, "first")
  assert.equal(entityTagObservation(reader.get("a")).failed, true)
  api.entityTags = async () => tags(null)
  await reader.tagEffects(["a"])
  assert.equal(reader.get("a").components.length, 1)
  assert.equal(entityTagObservation(reader.get("a")).failed, false)
  assert.equal(reader.get("a").components[0], before.components[0])
})

test("newer invalidation rejects a stale tag result and coalesces a trailing read", async () => {
  const { api, reader } = fixture()
  reader.demand(["a"])
  await tick()
  const held = deferred()
  let reads = 0
  api.entityTags = () => ++reads === 1 ? held.promise : Promise.resolve(tags("latest"))
  const observations = []
  reader.subscribe(() => observations.push(entityTagObservation(reader.get("a")).tags.map((tag) => tag.id)))
  const first = reader.tagEffects(["a"])
  await tick()
  const next = reader.tagEffects(["a"])
  held.resolve(tags("stale"))
  await Promise.all([first, next])
  assert.equal(reads, 2)
  assert.deepEqual(entityTagObservation(reader.get("a")).tags.map((tag) => tag.id), ["latest"])
  assert(!observations.some((ids) => ids.includes("stale")))
})

test("full reread cannot let an older tag request replace its newer component snapshot", async () => {
  const { api, reader } = fixture()
  reader.demand(["a"])
  await tick()
  const held = deferred(), file = deferred()
  let reads = 0
  api.entityTags = () => ++reads === 1 ? held.promise : Promise.resolve(tags("current"))
  const refresh = reader.tagEffects(["a"])
  await tick()
  api.file = () => file.promise
  await reader.reread("a")
  held.resolve(tags("stale"))
  await tick()
  assert.equal(reads, 1, "Tag reconciliation waits for the full read")
  file.resolve({ file_id: "a", kind_id: "9fd73d3d-d35d-41bc-8b73-402e12f5c017", byte_count: "99", relative_path: "a" })
  await refresh
  assert.equal(reader.get("a").components[0].bytes, "99")
  assert.equal(entityTagObservation(reader.get("a")).tags[0].id, "current")
})

test("inactive subjects refresh on demand; leaving a pending full read releases tag refresh waiters", async () => {
  const { api, calls, reader } = fixture()
  reader.demand(["a"])
  await tick()
  reader.demand(["b"])
  await tick()
  await reader.tagEffects(["a"])
  assert.equal(calls.tags, 0)
  reader.demand(["a"])
  await tick()
  assert.equal(calls.tags, 1)
  assert.equal(entityTagObservation(reader.get("a")).tags[0].id, "new")
  const held = deferred()
  api.file = () => held.promise
  await reader.reread("a")
  const refresh = reader.tagEffects(["a"])
  await tick()
  reader.demand([])
  await refresh
  assert.equal(reader.cacheSize, 1, "Only the inactive settled b record remains cached")
  held.resolve({ file_id: "a", kind_id: "9fd73d3d-d35d-41bc-8b73-402e12f5c017", byte_count: "1", relative_path: "a" })
  await tick()
})
