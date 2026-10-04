import assert from "node:assert/strict"
import { test } from "node:test"
import { EntityNotesCoordinator } from "../src/renderer/features/entity-notes/model/entity-notes.ts"
import { EntityNotesWrites } from "../src/renderer/features/entity-notes/model/notes-writes.ts"
import { PlaybackCoordinator } from "../src/renderer/features/video-playback/model/playback-coordinator.ts"
import { DraftPreparationCoordinator } from "../src/renderer/app/providers/draft-preparation.ts"

const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
function notesFixture() {
  const observed = new Map()
  const submissions = []
  const api = {
    entityNotes: async id => ({ entity_id: id, notes: observed.get(id) ?? "" }),
    writeEntityNotes: async (id, body) => {
      submissions.push({ id, ...body })
      observed.set(id, body.notes)
      return { status: "entity_notes_saved", notes: { entity_id: id, notes: body.notes } }
    },
  }
  const writes = new EntityNotesWrites(api)
  return { api, writes, submissions, observed,
    a: new EntityNotesCoordinator(api, writes), b: new EntityNotesCoordinator(api, writes) }
}

test("same Entity has private page drafts and one serialized submission lane", async () => {
  const { api, a, b, writes, submissions } = notesFixture()
  const sa = a.get("entity"), sb = b.get("entity")
  await a.read(sa); await b.read(sb)
  const original = api.writeEntityNotes
  const first = deferred()
  let calls = 0
  api.writeEntityNotes = async (id, body) => {
    if (++calls === 1) await first.promise
    return original(id, body)
  }
  a.update(sa, "A text")
  const savingA = a.save(sa)
  await tick()
  b.update(sb, "B private text")
  const savingB = b.save(sb)
  await tick()
  assert.equal(calls, 1, "B cannot execute through A's pending write")
  assert.equal(sa.draft, "A text")
  assert.equal(sb.draft, "B private text")
  first.resolve()
  await Promise.all([savingA, savingB])
  assert.deepEqual(submissions.map(s => s.notes), ["A text", "B private text"])
  assert.equal(sa.draft, "B private text", "A is now clean and may adopt B's confirmed value")
  a.dispose(); b.dispose()
  assert.equal(writes.observation("entity"), undefined, "last consumer releases confirmed Notes storage")
})

test("confirmed updates leave another page's unsaved text and saved basis intact", async () => {
  const { a, b } = notesFixture()
  const sa = a.get("entity"), sb = b.get("entity")
  await a.read(sa); await b.read(sb)
  b.update(sb, "still composing", true)
  a.update(sa, "confirmed A")
  await a.save(sa)
  assert.equal(sb.saved, "")
  assert.equal(sb.draft, "still composing")
  assert.equal(b.preparation().draft, true)
  assert.equal(b.discard(), true)
  assert.equal(sb.draft, "confirmed A", "discard reveals the latest qualified saved observation")
  a.dispose(); b.dispose()
})

test("a delayed clean read cannot overwrite a newer confirmed Notes write", async () => {
  const { api, a, b } = notesFixture()
  const sa = a.get("entity"), sb = b.get("entity")
  await a.read(sa); await b.read(sb)
  const oldRead = deferred()
  api.entityNotes = async id => { await oldRead.promise; return { entity_id: id, notes: "old" } }
  const reading = b.read(sb)
  a.update(sa, "new confirmed")
  await a.save(sa)
  oldRead.resolve()
  await reading
  assert.equal(sb.saved, "new confirmed")
  assert.equal(sb.draft, "new confirmed")
  a.dispose(); b.dispose()
})

test("uncertain Notes delivery retains the original recovery before a different page writes", async () => {
  const { api, a, b, submissions } = notesFixture()
  const sa = a.get("entity"), sb = b.get("entity")
  await a.read(sa); await b.read(sb)
  const original = api.writeEntityNotes
  api.writeEntityNotes = async (id, body) => { await original(id, body); throw new Error("response lost") }
  a.update(sa, "A uncertain")
  await a.save(sa)
  const request = sa.attempt.request_id
  assert.equal(a.discard(), false, "text discard cannot erase accepted request recovery")
  api.writeEntityNotes = original
  b.update(sb, "B later")
  await b.save(sb)
  assert.match(sb.error, /Another page/)
  assert.equal(sb.attempt, undefined, "B was not sent and is not an uncertain backend request")
  assert.equal(submissions.length, 1)
  await a.save(sa)
  assert.equal(submissions[1].request_id, request)
  await b.save(sb)
  assert.equal(submissions[2].notes, "B later")
  a.dispose(); b.dispose()
})

test("tab departure preserves independent progress and prevents stale leases changing shared audio", () => {
  const audio = { volume: 1, muted: false }
  const a = new PlaybackCoordinator(audio), b = new PlaybackCoordinator(audio)
  let pausedA = 0
  const first = a.activate("same", "file", () => pausedA++)
  first.save(80, 0.3, false)
  a.deactivate()
  assert.equal(pausedA, 1)
  const second = b.activate("same", "file", () => {})
  assert.equal(second.position, 0)
  second.save(250, 0.7, true)
  first.save(81, 0.1, false)
  assert.deepEqual(audio, { volume: 0.7, muted: true })
  assert.equal(a.position("same", "file"), 80)
  b.deactivate()
  assert.equal(a.activate("same", "file", () => {}).position, 80)
  assert.equal(b.position("same", "file"), 250)
  a.dispose()
  assert.equal(b.position("same", "file"), 250)
  b.dispose()
})

function participant() {
  const listeners = new Set()
  const p = {
    revision: 0, draft: false, sealed: false, prepareCount: 0,
    subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback) },
    preparation: () => ({ revision: p.revision, draft: p.draft }),
    prepare: async () => { p.prepareCount++; return p.preparation() },
    canSeal: revision => revision === p.revision && !p.draft,
    seal: revision => { p.sealed = p.canSeal(revision); return p.sealed },
    returnToApplication: () => { p.sealed = false },
    lost: () => {},
    change: () => { p.revision++; for (const listener of listeners) listener() },
    listenerCount: () => listeners.size,
  }
  return p
}

test("released page preparation no longer contributes readiness or notifications", async () => {
  const parent = new DraftPreparationCoordinator()
  const a = participant(), b = participant()
  const removeA = parent.add(a), removeB = parent.add(b)
  const before = await parent.prepare()
  removeA(); removeA()
  assert.equal(a.listenerCount(), 0)
  assert.equal(parent.size, 1)
  assert.equal(parent.canSeal(before.revision, false, false), false)
  const current = parent.preparation()
  a.draft = true; a.change()
  assert.deepEqual(parent.preparation(), current)
  removeB(); parent.dispose()
  assert.equal(b.listenerCount(), 0)
})

test("new participants during pending host preparation are prepared before a current report", async () => {
  const parent = new DraftPreparationCoordinator()
  const a = participant(), b = participant(), waiting = deferred()
  a.prepare = async () => { await waiting.promise; return a.preparation() }
  parent.add(a)
  const preparing = parent.prepare()
  b.draft = true
  parent.add(b)
  waiting.resolve()
  const state = await preparing
  assert(b.prepareCount > 0)
  assert.equal(state.draft, true)
  assert.equal(parent.canSeal(state.revision, false, false), false)
  parent.dispose()
})

test("failed aggregate sealing restores earlier participants without undoing their writes", async () => {
  const a = participant(), b = participant()
  const parent = new DraftPreparationCoordinator([a, b])
  const ready = await parent.prepare()
  b.seal = () => false
  assert.equal(parent.seal(ready.revision, false, false), false)
  assert.equal(a.sealed, false)
  assert.equal(b.sealed, false)
  parent.dispose()
})
