import assert from "node:assert/strict"
import { test } from "node:test"
import { setImmediate as turn } from "node:timers/promises"
import { EntityReader } from "../src/renderer/entities/entity/model/entity-reader.ts"
import { suppliedSequence } from "../src/renderer/entities/entity/model/identity-sequence.ts"
import { ApiFailure } from "../src/renderer/shared/api/backend-api.ts"

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
const imageKind = "aadf84d2-0dc0-4a81-8cdb-901162c78321",
  fileKind = "9fd73d3d-d35d-41bc-8b73-402e12f5c017"
const image = (id, file = `file-${id}`, width = 42) => ({
  record: {
    target: { kind: "image", component_id: id },
    revision: "1",
    basis: file,
    facts: { kind: "image", format: "png", width, height: 20 },
    last_failure: null,
  },
  applicability: { status: "matching", file_id: file },
})
test("saved preview discovery follows current input and its read failure retains successful Media metadata", async () => {
  let current = "first",
    fail = false
  const calls = []
  const { api, reader } = fixture({
    media: async (_kind, id) => image(id, current),
    savedPreview: async (kind, id) => {
      calls.push([id, current])
      if (fail) throw Error("preview read failed")
      return { locator: current, file_id: current, kind, edge: 512, origin: "hit", stream_index: null }
    },
    previewBytes: async () => new Blob(["png"]),
  })
  reader.demand(["a"])
  await tick()
  assert.equal(reader.get("a").components[0].readStatus, "ready")
  current = "second"
  await reader.reread("a")
  await tick()
  assert.deepEqual(
    calls.map((c) => c[1]),
    ["first", "second"],
  )
  current = "third"
  fail = true
  await reader.reread("a")
  await tick()
  assert.equal(reader.get("a").components[0].readStatus, "ready")
  assert(reader.get("a").problems.some((p) => p.message.includes("preview read failed")))
  void api
})
function fixture(overrides = {}, capacity = 256) {
  const api = {
    identities: async () => suppliedSequence(["a", "b", "c"]),
    memberships: async (ids) =>
      ids.map((entity_id) => ({
        status: "present",
        entity_id,
        memberships: [{ entity_id, kind_id: imageKind, component_id: entity_id }],
      })),
    media: async (_kind, id) => image(id),
    file: async (id) => ({
      file_id: id,
      kind_id: fileKind,
      relative_path: `object/${id}`,
      byte_count: "9007199254740993",
    }),
    ...overrides,
  }
  return { api, reader: new EntityReader(api, capacity) }
}
test("all attached metadata is read progressively and unsupported membership stays attributed", async () => {
  const held = deferred()
  const { reader } = fixture({
    memberships: async () => [
      {
        status: "present",
        entity_id: "a",
        memberships: [
          { entity_id: "a", component_id: "f", kind_id: fileKind },
          { entity_id: "a", component_id: "i", kind_id: imageKind },
          { entity_id: "a", component_id: "u", kind_id: "unknown-kind" },
        ],
      },
    ],
    media: () => held.promise,
  })
  reader.demand(["a"])
  await tick()
  assert.equal(reader.get("a").components.find((c) => c.kind === "file").bytes, "9007199254740993")
  assert.equal(reader.get("a").components.find((c) => c.kind === "image").readStatus, "loading")
  assert.match(reader.get("a").problems[0].message, /unknown-kind/)
  held.resolve(image("i"))
  await tick()
  assert.equal(reader.get("a").components.find((c) => c.kind === "image").width, 42)
})
test("repeated failed rereads retain successful same-subject facts; replacements never inherit them", async () => {
  const { reader, api } = fixture()
  reader.demand(["a"])
  await tick()
  api.memberships = async () => {
    throw new Error("membership DB unavailable")
  }
  await reader.reread("a")
  await reader.reread("a")
  assert.equal(reader.get("a").components[0].width, 42)
  assert.equal(reader.get("a").problems.find((p) => p.key === "membership").previous, true)
  api.memberships = async () => [
    {
      status: "present",
      entity_id: "a",
      memberships: [{ entity_id: "a", component_id: "replacement", kind_id: imageKind }],
    },
  ]
  api.media = async () => {
    throw new Error("new record unreadable")
  }
  await reader.reread("a")
  await tick()
  assert.equal(reader.get("a").components[0].id, "replacement")
  assert.equal(reader.get("a").components[0].width, undefined)
})
test("confirmed missing record clears old payload while transport failure preserves it", async () => {
  const { reader, api } = fixture()
  reader.demand(["a"])
  await tick()
  api.media = async () => {
    throw new Error("transport failure")
  }
  await reader.reread("a")
  await tick()
  assert.equal(reader.get("a").components[0].width, 42)
  api.media = async () => {
    throw new ApiFailure(
      {
        code: "operation_failed",
        message: "Domain operation failed",
        diagnostic: {
          owner: "media",
          error: { code: "missing_record", target: { kind: "image", component_id: "a" } },
        },
      },
      500,
    )
  }
  await reader.reread("a")
  await tick()
  assert.equal(reader.get("a").components[0].width, undefined)
  assert.match(reader.get("a").problems.at(-1).message, /missing record/)
})
test("resource failures survive metadata success and reject old retries and old cache lifetimes", async () => {
  const { reader } = fixture({}, 1)
  reader.demand(["a"])
  await tick()
  const basis = "a:file-a",
    old = reader.resourceRevision("a")
  reader.resourceResult("a", basis, old, "decode failed")
  await reader.reread("a")
  await tick()
  const retry = reader.resourceRevision("a")
  assert(reader.get("a").problems.some((p) => p.recovery === "resource"))
  reader.resourceResult("a", basis, old)
  assert(reader.get("a").problems.some((p) => p.recovery === "resource"))
  reader.resourceResult("a", basis, retry)
  assert(!reader.get("a").problems.some((p) => p.recovery === "resource"))
  reader.demand(["b"])
  await tick()
  reader.demand(["a"])
  await tick()
  const lifetime = reader.resourceRevision("a")
  assert.notEqual(lifetime, old)
  reader.resourceResult("a", basis, lifetime, "new failure")
  reader.resourceResult("a", basis, old)
  assert(reader.get("a").problems.some((p) => p.message === "new failure"))
})
test("removed Image drops its resource subject and stale late metadata cannot resurrect it", async () => {
  const { reader, api } = fixture()
  reader.demand(["a"])
  await tick()
  reader.resourceResult("a", "a:file-a", reader.resourceRevision("a"), "bad bytes")
  const held = deferred()
  api.media = () => held.promise
  await reader.reread("a")
  api.memberships = async () => [{ status: "present", entity_id: "a", memberships: [] }]
  await reader.reread("a")
  held.resolve(image("a"))
  await tick()
  assert.deepEqual(reader.get("a").components, [])
  assert.deepEqual(reader.get("a").problems, [])
})
test("held obsolete ranges have bounded retained work and current range wins", async () => {
  const held = deferred()
  const { reader } = fixture({ media: () => held.promise }, 32)
  for (let range = 0; range < 20; range++) {
    reader.demand(Array.from({ length: 20 }, (_, offset) => `${range * 20 + offset}`))
    await tick()
  }
  assert(reader.cacheSize <= 32)
  assert(reader.pendingCount <= 28)
  held.resolve(image("irrelevant"))
  await tick()
})
test("failed identity refresh preserves sequence; refresh epoch rereads a newly visible cached range", async () => {
  let width = 42
  const { reader, api } = fixture({ media: async (_kind, id) => image(id, `file-${id}`, width) })
  await reader.refresh()
  const previous = reader.sequence
  reader.demand(["a"])
  await tick()
  reader.demand(["b"])
  await tick()
  reader.demand(["a"])
  await tick()
  api.identities = async () => {
    throw new Error("truncated IDs")
  }
  assert.equal(await reader.refresh(), false)
  assert.strictEqual(reader.sequence, previous)
  api.identities = async () => suppliedSequence(["c", "b", "a"])
  width = 88
  assert.equal(await reader.refresh(), true)
  reader.demand(["b"])
  await tick()
  assert.equal(reader.get("b").components[0].width, 88)
})
test("coalescing an ordinary new range preserves an explicit reread of a still-active Entity", async () => {
  const hold = deferred()
  let aReads = 0,
    held = false
  const { reader, api } = fixture({
    media: async (_kind, id) => {
      if (id === "a") aReads++
      return image(id)
    },
  })
  reader.demand(["a"])
  await tick()
  const memberships = api.memberships
  api.memberships = async (ids) => {
    if (ids.includes("b") && !held) {
      held = true
      await hold.promise
    }
    return memberships(ids)
  }
  reader.demand(["a", "b"])
  await tick()
  const reread = reader.reread("a")
  reader.demand(["a", "b", "c"])
  await tick()
  hold.resolve()
  await reread
  await tick()
  assert.equal(aReads, 2)
})

test("import effects reread only demanded subjects and retain latest queued effect without list refresh", async () => {
  let lists = 0,
    reads = []
  const pending = deferred()
  let block = false
  const f = fixture({
    identities: async () => {
      lists++
      return suppliedSequence(["a", "b", "c"])
    },
    memberships: async (ids) => {
      reads.push([...ids])
      if (block) {
        block = false
        await pending.promise
      }
      return ids.map((entity_id) => ({
        status: "present",
        entity_id,
        memberships: [{ entity_id, kind_id: imageKind, component_id: entity_id }],
      }))
    },
  })
  await f.reader.refresh()
  f.reader.demand(["a"])
  await tick()
  const sequence = f.reader.sequence
  block = true
  const effect = (id) => ({ current: { entity_id: id, kinds: [] } })
  f.reader.importEffects([effect("a"), effect("b")])
  await tick()
  f.reader.importEffects([effect("a")])
  f.reader.importEffects([effect("a")])
  pending.resolve()
  await tick()
  await tick()
  assert.equal(lists, 1)
  assert.equal(f.reader.sequence, sequence)
  assert(reads.every((ids) => ids.every((id) => id === "a")))
  assert(reads.length <= 3)
  f.reader.demand(["b"])
  await tick()
  assert(reads.some((ids) => ids.includes("b")))
})

const videoKind = "f4be9375-60f1-4d04-8f07-8c9ad765e230"
const video = (file = "f1", applicability) => ({
  record: {
    target: { kind: "video", component_id: "v" },
    revision: "1",
    basis: file,
    facts: { kind: "video", container: "mp4", stream_index: 0 },
    last_failure: { code: "unsupported", detail: "Earlier interpretation failed" },
  },
  applicability: applicability ?? { status: "matching", file_id: file },
})
function videoFixture() {
  return fixture({
    memberships: async () => [
      {
        status: "present",
        entity_id: "a",
        memberships: [
          { entity_id: "a", component_id: "v", kind_id: videoKind },
          { entity_id: "a", component_id: "i", kind_id: imageKind },
        ],
      },
    ],
    media: async (kind) => (kind === "video" ? video() : image("i")),
  })
}
test("Video resource attempts distinguish metadata refresh, retry, and failed current-input observation", async () => {
  const { reader, api } = videoFixture()
  reader.demand(["a"])
  await tick()
  const attempt = reader.playbackRevision("a")
  reader.resourceResult("a", "v:f1", attempt, "Video decode failed")
  reader.resourceResult("a", "i:file-i", reader.resourceRevision("a"), "Image decode failed")
  reader.importEffects([{ current: { entity_id: "a", kinds: [] } }])
  await tick()
  assert.equal(reader.playbackRevision("a"), attempt)
  assert(reader.get("a").problems.some((p) => p.message === "Video decode failed"))
  assert(reader.get("a").problems.some((p) => p.message === "Image decode failed"))
  reader.retryResource("a", "i:file-i")
  assert.equal(reader.playbackRevision("a"), attempt)
  assert.equal(reader.playbackPending("a"), false)
  const held = deferred()
  api.media = async (kind) => (kind === "video" ? held.promise : image("i"))
  reader.retryResource("a")
  await tick()
  assert(reader.playbackPending("a"))
  reader.resourceResult("a", "v:f1", attempt)
  assert(reader.get("a").problems.some((p) => p.message === "Video decode failed"))
  held.resolve(video())
  await tick()
  const retry = reader.playbackRevision("a")
  assert.notEqual(retry, attempt)
  reader.resourceResult("a", "v:f1", attempt)
  assert(reader.get("a").problems.some((p) => p.message === "Video decode failed"))
  reader.resourceResult("a", "v:f1", retry)
  assert(!reader.get("a").problems.some((p) => p.message === "Video decode failed"))
  assert(reader.get("a").problems.some((p) => p.message.includes("Earlier interpretation failed")))
  assert(reader.get("a").problems.some((p) => p.message === "Image decode failed"))
  api.media = async (kind) =>
    kind === "video"
      ? video("f1", {
          status: "error",
          diagnostic: { owner: "file", error: { kind: "access", message: "Context unavailable" } },
        })
      : image("i")
  reader.retryResource("a")
  await tick()
  const retained = reader.get("a").components.find((c) => c.kind === "video")
  assert.equal(retained.inputFileId, "f1")
  assert.equal(retained.inputPrevious, true)
  assert.equal(reader.playbackRevision("a"), retry)
  assert.equal(reader.playbackPending("a"), false)
  api.media = async (kind) => (kind === "video" ? video("f2") : image("i"))
  await reader.reread("a")
  await tick()
  assert.equal(reader.get("a").components.find((c) => c.kind === "video").inputFileId, "f2")
  reader.resourceResult("a", "v:f1", retry, "obsolete")
  assert(!reader.get("a").problems.some((p) => p.message === "obsolete"))
})

test("only successful Video input observations inform the run-local playback owner", async () => {
  const { api } = videoFixture()
  const observed = []
  const reader = new EntityReader(api, 256, (id, file) => observed.push([id, file]))
  reader.demand(["a"])
  await tick()
  assert.deepEqual(observed, [["a", "f1"]])
  api.media = async () => {
    throw new Error("Context read failed")
  }
  await reader.reread("a")
  await tick()
  assert.deepEqual(observed, [["a", "f1"]])
  api.media = async (kind) => (kind === "video" ? video("f2") : image("i"))
  await reader.reread("a")
  await tick()
  assert.deepEqual(observed.at(-1), ["a", "f2"])
  api.memberships = async () => [{ status: "present", entity_id: "a", memberships: [] }]
  await reader.reread("a")
  await tick()
  assert.deepEqual(observed.at(-1), ["a", undefined])
})
