import assert from "node:assert/strict"
import { test } from "node:test"
import { setImmediate as turn, setTimeout as delay } from "node:timers/promises"
import { EntityReader } from "../src/renderer/entities/entity/model/entity-reader.ts"
import { PreferenceCoordinator } from "../src/renderer/features/entity-view-preferences/model/preference-coordinator.ts"
import { CardCoverCoordinator } from "../src/renderer/features/entity-card-cover/model/card-cover.ts"
import { FilterCoordinator } from "../src/renderer/features/entity-filter/model/filter-coordinator.ts"
import { suppliedSequence } from "../src/renderer/entities/entity/model/identity-sequence.ts"

const tick = async () => { await turn(); await turn() }
const profile = { format: "locus-native-tantivy-0.26", version: 2 }
const imageKind = "aadf84d2-0dc0-4a81-8cdb-901162c78321"
test("repeated native preparation states do not invalidate an already reported page revision", () => {
  const { api } = filterApi()
  const filter = new FilterCoordinator(api)
  filter.host(true)
  const state = filter.preparation()
  filter.host(true)
  assert.equal(filter.preparation().revision, state.revision)
  assert.equal(filter.canSeal(state.revision, false, true), true)
  filter.host(false)
  assert.equal(filter.hostClosing, false)
  filter.dispose()
})
function filterApi() {
  const calls = [], released = []
  const api = {
    identities: async () => suppliedSequence(["all"]),
    filterLanguage: async () => profile,
    filterAnalyze: async source => ({ source, state: source.text ? "valid" : "empty", diagnostics: [], parsed: null }),
    search: async source => {
      calls.push(source)
      const context = `context-${calls.length}`
      return { entities: suppliedSequence(["a", "b"]), context, generation: "generation", coveredSequence: "1", expiresAfterSeconds: 600,
        release: async () => { released.push(context) } }
    },
  }
  return { api, calls, released }
}

test("category scope composes nested user criteria but remains outside drafts and saved Filter source", async t => {
  const { api, calls } = filterApi()
  const category = `entity_kinds:"${imageKind}" OR entity_kinds:"video"`
  const page = new FilterCoordinator(api, () => {}, category)
  t.after(() => page.dispose())
  await page.refresh()
  assert.equal(calls[0].text, category)
  assert.equal(page.appliedFilter, undefined)
  page.draft = { name: "", source: { ...profile, text: "(alpha OR beta) AND NOT gamma" } }
  await page.apply()
  assert.equal(calls[1].text, `(${category}) AND ((alpha OR beta) AND NOT gamma)`)
  assert.equal(page.appliedFilter.text, "(alpha OR beta) AND NOT gamma")
  page.draft = { name: "", source: { ...profile, text: "" } }
  await page.apply()
  assert.equal(calls[2].text, category)
  assert.equal(page.draft.source.text, "")
  assert.equal(page.sequence.length, 2)
})

test("receiving page retains R0 identities and original evidence after source refresh and close", async t => {
  const { api, calls, released } = filterApi()
  const source = new FilterCoordinator(api), receiver = new FilterCoordinator(api)
  t.after(() => { source.dispose(); receiver.dispose() })
  source.draft = { name: "", source: { ...profile, text: "alpha" } }
  await source.apply()
  const result = source.established
  receiver.adopt(result)
  assert.equal(calls.length, 1)
  assert.equal(receiver.established, result)
  assert.equal(receiver.sequence, source.sequence)
  assert.equal(receiver.established.expiresAt, result.expiresAt)
  assert.equal(receiver.draft.name, "")
  await source.refresh()
  assert.equal(calls.length, 2)
  assert.equal(receiver.established, result)
  assert.deepEqual(released, [])
  source.dispose()
  assert.deepEqual(released, ["context-2"])
  receiver.dispose()
  receiver.dispose()
  assert.deepEqual(released, ["context-2", "context-1"])
})

test("confirmed preset persistence satisfies close without applying or replacing a newer draft", async t => {
  const { api, calls } = filterApi()
  const page = new FilterCoordinator({ ...api,
    filterPresets: async () => [],
    filterWrite: async () => { throw Error("lost response") },
    submission: async () => ({ status: "direct_complete", outcome: { status: "filter_saved",
      preset: { id: "saved", name: "Named", revision: "2", source: { ...profile, text: "new" } } } }),
  })
  t.after(() => page.dispose())
  page.open = true
  page.saved = { id: "saved", name: "Named", revision: "1", source: { ...profile, text: "old" } }
  page.draft = { name: "Named", source: { ...profile, text: "new" } }
  await page.save()
  assert(page.preparation().blocked)
  await page.reconcile()
  assert.equal(page.saved.revision, "1", "Confirmation keeps the existing explicit-load reconciliation semantics")
  assert.equal(page.preparation().blocked, undefined)
  assert.equal(page.preparation().draft, false)
  assert.equal(calls.length, 0, "Persistence confirmation does not apply a query")
  page.edit({ name: "Named", source: { ...profile, text: "later local edit" } })
  assert.equal(page.preparation().draft, true)
})

test("an old uncertain save cannot satisfy another preset's identical-text draft guard", async t => {
  const { api } = filterApi()
  const captured = { name: "Same name", source: { ...profile, text: "same edited text" } }
  const page = new FilterCoordinator({ ...api,
    filterPresets: async () => [],
    filterPreset: async id => ({ id, name: "Same name", revision: "1", source: { ...profile, text: `original ${id}` } }),
    filterWrite: async () => { throw Error("lost response") },
    submission: async () => ({ status: "direct_complete", outcome: { status: "filter_saved",
      preset: { id: "A", name: captured.name, revision: "2", source: captured.source } } }),
  })
  t.after(() => page.dispose())
  page.open = true
  page.requestSwitch("A"); await tick()
  page.edit(structuredClone(captured)); await page.save()
  const originalRequest = page.uncertain.request
  page.requestSwitch("B"); await page.resolveGuard("discard")
  page.edit(structuredClone(captured))
  assert.equal(page.saved.id, "B")
  assert.equal(page.preparation().draft, true)
  await page.reconcile(originalRequest)
  assert.equal(page.saved.id, "B")
  assert.equal(page.preparation().blocked, undefined)
  assert.equal(page.preparation().draft, true, "Equal content does not associate A's confirmation with B")
})

test("late saved receipt cannot replace a newly loaded preset with identical draft content", async t => {
  const { api, calls } = filterApi()
  let resolve
  const receipt = new Promise(done => { resolve = done })
  const captured = { name: "Same name", source: { ...profile, text: "same edited text" } }
  const page = new FilterCoordinator({ ...api,
    filterPresets: async () => [],
    filterPreset: async id => ({ id, name: "Same name", revision: "1", source: { ...profile, text: `original ${id}` } }),
    filterWrite: () => receipt,
  })
  t.after(() => page.dispose())
  page.open = true
  page.requestSwitch("A"); await tick()
  page.edit(structuredClone(captured))
  const saving = page.save()
  page.close(); page.show()
  page.requestSwitch("B"); await page.resolveGuard("discard")
  page.edit(structuredClone(captured))
  resolve({ status: "filter_saved", preset: { id: "A", name: captured.name, revision: "2", source: captured.source } })
  await saving
  assert.equal(page.saved.id, "B", "The receipt belongs to the replaced A association")
  assert.equal(page.preparation().draft, true)
  assert.equal(calls.length, 0)
})

test("closing and reopening only the Filter panel retains pending save association", async t => {
  const { api, calls } = filterApi()
  let resolve
  const receipt = new Promise(done => { resolve = done })
  const page = new FilterCoordinator({ ...api,
    filterPresets: async () => [],
    filterPreset: async id => ({ id, name: "Named", revision: "1", source: { ...profile, text: "old" } }),
    filterWrite: () => receipt,
  })
  t.after(() => page.dispose())
  page.open = true
  page.requestSwitch("A"); await tick()
  page.edit({ name: "Named", source: { ...profile, text: "new" } })
  const saving = page.save()
  page.close(); page.show()
  resolve({ status: "filter_saved", preset: { id: "A", name: "Named", revision: "2", source: { ...profile, text: "new" } } })
  await saving
  assert.equal(page.saved.revision, "2")
  assert.equal(page.preparation().draft, false)
  assert.equal(calls.length, 0, "Reopened panels receive confirmation without reviving abandoned Apply")
})

test("deleting the loaded preset leaves a disposable temporary draft", async t => {
  const { api } = filterApi()
  const page = new FilterCoordinator({ ...api,
    filterPresets: async () => [],
    filterPreset: async id => ({ id, name: "Named", revision: "1", source: { ...profile, text: "old" } }),
    filterWrite: async () => ({ status: "filter_deleted" }),
  })
  t.after(() => page.dispose())
  page.open = true
  page.requestSwitch("A"); await tick()
  page.edit({ name: "Named", source: { ...profile, text: "retained source" } })
  assert.equal(page.preparation().draft, true)
  await page.deletePreset()
  assert.equal(page.saved, undefined)
  assert.equal(page.draft.source.text, "retained source")
  assert.equal(page.preparation().draft, false)
})

test("transferred evidence expires at the original deadline without dropping retained identities", async t => {
  const { api, released } = filterApi()
  const source = new FilterCoordinator(api), receiver = new FilterCoordinator(api)
  t.after(() => { source.dispose(); receiver.dispose() })
  source.draft = { name: "", source: { ...profile, text: "alpha" } }
  await source.apply()
  const result = { ...source.established, expiresAt: Date.now() + 15 }
  receiver.adopt(result)
  source.dispose()
  assert.deepEqual(released, [])
  await delay(30)
  assert.equal(receiver.evidenceExpired, true)
  assert.equal(receiver.sequence.length, 2)
  assert.deepEqual(released, ["context-1"])
})

test("consumer release preserves remaining metadata/preferences/covers demand", async () => {
  const reader = new EntityReader({ memberships: async ids => ids.map(entity_id => ({ entity_id, status: "present", memberships: [] })) }, 1)
  const a = reader.acquireDemand(), b = reader.acquireDemand()
  a.update(["a"]); b.update(["b"])
  await tick()
  assert.equal(reader.get("a").membershipsStatus, "present")
  assert.equal(reader.get("b").membershipsStatus, "present")
  a.release(); a.release()
  await tick()
  assert.equal(reader.get("b").membershipsStatus, "present")
  assert.equal(reader.cacheSize, 1)
  b.release()

  const preferences = new PreferenceCoordinator({ preferences: async ids => ids.map(entity_id => ({ entity_id, status: "unset" })) }, () => "request", 1)
  const pa = preferences.acquireDemand(), pb = preferences.acquireDemand()
  pa.update(["a"]); pb.update(["b"])
  await tick()
  pa.release()
  assert.equal(preferences.get("b").observation.status, "unset")
  pb.release()

  const covers = new CardCoverCoordinator({ cardCoverPreferences: async ids => ids.map(entity_id => ({ entity_id, status: "unset" })) }, id => ({ id, components: [] }))
  const ca = covers.acquireDemand(), cb = covers.acquireDemand()
  ca.update(["a"]); cb.update(["b"])
  await tick()
  ca.release()
  assert.deepEqual([...covers.needed], ["b"])
  assert.equal(covers.get("b").observed.status, "unset")
  cb.release(); covers.dispose()
})

test("player decode failure and retry remain with the resource consumer", async () => {
  const api = {
    memberships: async ids => ids.map(entity_id => ({ entity_id, status: "present", memberships: [{ kind_id: imageKind, component_id: "image" }] })),
    media: async () => ({ record: { target: { kind: "image", component_id: "image" }, revision: "1", basis: "file", facts: { kind: "image", format: "png", width: 1, height: 1 }, last_failure: null }, applicability: { status: "matching", file_id: "file" } }),
  }
  const shared = new EntityReader(api), a = shared.scoped(), b = shared.scoped()
  a.reader.demand(["entity"]); b.reader.demand(["entity"])
  await tick()
  const generation = a.reader.resourceRevision("entity"), other = b.reader.resourceRevision("entity")
  a.reader.resourceResult("entity", "image:file", generation, "Decode failed in A")
  assert.equal(a.reader.get("entity").problems.some(problem => problem.message === "Decode failed in A"), true)
  assert.equal(b.reader.get("entity").problems.some(problem => problem.message === "Decode failed in A"), false)
  a.reader.retryResource("entity", "image:file")
  await tick()
  assert.equal(b.reader.resourceRevision("entity"), other)
  assert.equal(a.reader.resourceRevision("entity"), generation + 1)
  assert.equal(a.reader.get("entity").problems.some(problem => problem.message === "Decode failed in A"), true)
  a.reader.resourceResult("entity", "image:file", generation + 1)
  assert.equal(a.reader.get("entity").problems.some(problem => problem.message === "Decode failed in A"), false)
  a.release()
  const revision = shared.snapshot()
  a.reader.resourceResult("entity", "image:file", generation, "late retired failure")
  a.reader.retryResource("entity")
  assert.equal(shared.snapshot(), revision)
  b.release()
})
