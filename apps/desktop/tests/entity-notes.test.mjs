import assert from "node:assert/strict"
import { test } from "node:test"
import { EntityNotesCoordinator } from "../src/renderer/features/entity-notes/model/entity-notes.ts"
import { DraftPreparationCoordinator } from "../src/renderer/app/providers/draft-preparation.ts"

const tick = () => new Promise((resolve) => setImmediate(resolve))
function fixture() {
  const writes = []
  const api = {
    entityNotes: async (id) => ({ entity_id: id, notes: "" }),
    writeEntityNotes: async (id, body) => {
      writes.push({ id, ...body })
      return { status: "entity_notes_saved", notes: { entity_id: id, notes: body.notes } }
    },
  }
  return { api, writes, c: new EntityNotesCoordinator(api) }
}
test("notes serialize continued typing and keep the original Entity during navigation", async () => {
  const { api, c, writes } = fixture()
  const a = c.get("a"), b = c.get("b")
  await c.read(a)
  await c.read(b)
  let release
  const original = api.writeEntityNotes
  api.writeEntityNotes = async (id, body) => {
    await new Promise((resolve) => { release = resolve })
    return original(id, body)
  }
  c.update(a, "first")
  const saving = c.save(a)
  await tick()
  c.update(a, "latest 中文\n")
  assert.equal(c.get("a"), a)
  assert.equal(b.draft, "")
  api.writeEntityNotes = original
  release()
  await saving
  assert.deepEqual(writes.map(({ id, notes }) => [id, notes]), [["a", "first"], ["a", "latest 中文\n"]])
  assert.equal(a.saved, a.draft)
  c.dispose()
})
test("lost responses retain draft and original request; reread cannot overwrite unsaved notes", async () => {
  const { api, c, writes } = fixture()
  const s = c.get("a")
  await c.read(s)
  const original = api.writeEntityNotes
  api.writeEntityNotes = async (id, body) => { await original(id, body); throw new Error("lost response") }
  c.update(s, "keep this")
  await c.save(s)
  assert.equal(s.error, "lost response")
  await c.read(s)
  assert.equal(s.draft, "keep this")
  c.update(s, "and this")
  api.writeEntityNotes = original
  await c.save(s)
  assert.equal(writes[0].request_id, writes[1].request_id)
  assert.notEqual(writes[1].request_id, writes[2].request_id)
  assert.equal(s.saved, "and this")
  c.dispose()
})
test("IME composition waits; close preparation flushes notes and protects failed or lost drafts", async () => {
  const { api, c, writes } = fixture()
  const s = c.get("a")
  await c.read(s)
  c.update(s, "拼", true)
  await c.save(s)
  assert.equal(writes.length, 0)
  c.update(s, "拼音输入", false)
  const prep = new DraftPreparationCoordinator([c])
  c.host(true)
  const clean = await prep.prepare()
  assert.equal(clean.draft, false)
  assert.equal(writes[0].notes, "拼音输入")
  c.host(false)
  api.writeEntityNotes = async () => { throw new Error("offline") }
  c.update(s, "unsaved")
  const dirty = await prep.prepare()
  assert(dirty.draft)
  assert(dirty.blocked)
  assert.equal(prep.canSeal(dirty.revision, true, true), false)
  c.lost()
  assert.equal(s.draft, "unsaved")
  assert.equal(c.editable, false)
  c.dispose()
})
test("read failure never enables writing empty notes over an unknown value", async () => {
  const { api, c, writes } = fixture()
  api.entityNotes = async () => { throw new Error("unavailable") }
  const s = c.get("a")
  await c.read(s)
  c.update(s, "replacement")
  await c.save(s)
  assert.equal(s.saved, undefined)
  assert.equal(writes.length, 0)
  api.entityNotes = async (id) => ({ entity_id: id, notes: "existing notes" })
  await c.read(s)
  assert.equal(s.draft, "existing notes")
  c.dispose()
})
