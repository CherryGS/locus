import assert from "node:assert/strict"
import { test } from "node:test"
import { TagDetails } from "../src/renderer/features/tags/model/tag-detail.ts"
import { TagCoordinator } from "../src/renderer/features/tags/model/tag-coordinator.ts"
import { SettingsPreparationCoordinator } from "../src/renderer/features/settings/model/settings-preparation.ts"

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const document = (id = "tag", revision = "r1", markdown = "# Old\n") => ({
  tag: { id, name: id, revision, parent: null },
  markdown,
})
function fixture(overrides = {}) {
  const sent = [],
    released = []
  const api = {
    tags: async () => [document().tag],
    tagDocument: async (id) => document(id),
    tagWrite: async (body) => {
      sent.push(body)
      return { status: "tag_saved", tag: document("tag", "r2").tag }
    },
    filterLanguage: async () => ({ format: "native", version: "1" }),
    filterLiteral: async (input) => ({ condition: input.field }),
    search: async (input) => ({
      entities: input.text,
      release: async () => {
        released.push(input.text)
      },
    }),
    ...overrides,
  }
  const tags = new TagCoordinator(api, "run", () => {})
  const c = new TagDetails(api, tags),
    s = c.state("tag")
  return { api, tags, c, s, sent, released }
}
test("opening normalized Markdown never writes; immediate Save reads live editor text", async () => {
  const f = fixture()
  await f.c.read(f.s)
  f.s.document.markdown = "Title\n=====\n"
  f.c.begin(f.s)
  f.c.mounted(f.s, "# Title\n")
  assert.equal(f.c.dirty(f.s), false)
  assert(await f.c.save(f.s))
  assert.equal(f.sent.length, 0)
  f.c.begin(f.s)
  f.c.mounted(f.s, "# Title\n")
  f.s.editor = { read: () => "# 中文新内容\n", readonly: () => {} }
  assert(await f.c.save(f.s))
  assert.equal(f.sent[0].change.markdown, "# 中文新内容\n")
  assert.equal(f.s.document.markdown, "# 中文新内容\n")
  assert.equal(f.s.document.tag.revision, "r2")
})
test("failed save retains text; fresh guard read never replaces draft; recovery retains original request", async () => {
  const f = fixture({
    tagWrite: async () => ({
      status: "tag_failed",
      reason: "conflict",
      uncertain: false,
      message: "stale",
    }),
  })
  await f.c.read(f.s)
  f.c.begin(f.s)
  f.c.mounted(f.s, "# Old\n")
  f.c.update(f.s, "New")
  assert.equal(await f.c.save(f.s), false)
  assert.equal(f.s.draft, "New")
  f.api.tagDocument = async () => document("tag", "r3", "Other saved text")
  await f.c.read(f.s)
  assert.equal(f.s.document.tag.revision, "r1")
  await f.c.read(f.s, true)
  assert.equal(f.s.document.tag.revision, "r3")
  assert.equal(f.s.draft, "New")
  let captured, observed
  f.api.tagWrite = async (body) => {
    captured = body
    throw new Error("lost response")
  }
  assert.equal(await f.c.save(f.s), false)
  assert.equal(f.c.discard(f.s), false)
  f.api.submission = async (id) => {
    observed = id
    return {
      status: "direct_complete",
      outcome: { status: "tag_saved", tag: document("tag", "r4").tag },
    }
  }
  await f.c.recover(f.s)
  assert.equal(observed, captured.request_id)
  assert.equal(f.s.editing, false)
  assert.equal(f.s.document.markdown, "New")
})
test("late document and query results cannot overwrite a newer intent; failed scope retains prior result", async () => {
  const first = deferred(),
    second = deferred(),
    searches = []
  const f = fixture({
    search: async () => {
      const d = deferred()
      searches.push(d)
      return d.promise
    },
  })
  f.api.tagDocument = () => first.promise
  const old = f.c.read(f.s)
  f.api.tagDocument = () => second.promise
  const now = f.c.read(f.s)
  second.resolve(document("tag", "new"))
  await now
  first.resolve(document("tag", "old"))
  await old
  assert.equal(f.s.document.tag.revision, "new")
  const direct = f.c.query(f.s, false)
  await new Promise((r) => setImmediate(r))
  const inclusive = f.c.query(f.s, true)
  await new Promise((r) => setImmediate(r))
  const result = (entities) => ({ entities, release: async () => {} })
  searches[1].resolve(result("inclusive"))
  await inclusive
  searches[0].resolve(result("direct"))
  await direct
  assert.equal(f.s.sequence, "inclusive")
  assert.equal(f.s.scope, true)
  f.api.search = async () => {
    throw new Error("offline")
  }
  await f.c.query(f.s, false)
  assert.equal(f.s.sequence, "inclusive")
  assert.equal(f.s.scope, true)
  assert.equal(f.s.requestedScope, false)
  assert.equal(f.s.queryError, "offline")
})
test("native preparation captures edits before debounce, waits writes, rejects stale discard consent and preserves lost text", async () => {
  const write = deferred(),
    f = fixture({ tagWrite: () => write.promise })
  await f.c.read(f.s)
  f.c.begin(f.s)
  f.c.mounted(f.s, "# Old\n")
  let live = "one"
  f.s.editor = { read: () => live, readonly: () => {} }
  const prep = new SettingsPreparationCoordinator([])
  prep.add(f.c)
  const initial = await prep.prepare()
  assert(initial.draft)
  live = "two"
  assert.equal(prep.canSeal(initial.revision, true, true), false)
  const next = await prep.prepare()
  assert(prep.canSeal(next.revision, true, true))
  const save = f.c.save(f.s)
  let done = false
  const preparing = prep.prepare().then((value) => {
    done = true
    return value
  })
  await Promise.resolve()
  assert.equal(done, false)
  write.resolve({ status: "tag_saved", tag: document("tag", "saved").tag })
  await save
  const clean = await preparing
  assert.equal(clean.draft, false)
  f.c.begin(f.s)
  f.c.mounted(f.s, "two")
  f.s.editor = { read: () => "lost input", readonly: () => {} }
  f.c.lost("lost")
  assert.equal(f.s.draft, "lost input")
  assert.equal(await f.c.save(f.s), false)
  assert(f.c.preparation().blocked)
})
