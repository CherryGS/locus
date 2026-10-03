import assert from "node:assert/strict"
import { test } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { FilterCoordinator } from "../src/renderer/features/entity-filter/model/filter-coordinator.ts"
import { emptyDraft } from "../src/renderer/features/entity-filter/model/draft.ts"
import { suppliedSequence } from "../src/renderer/entities/entity/model/identity-sequence.ts"
import {
  directDestination,
  inspectionDestination,
  relatedDestination,
  contextSequence,
  resolveReturn,
  adjacentId,
  entitySearch,
} from "../src/renderer/pages/entity/model/navigation.ts"
import { ApiFailure, BackendApi, errorText } from "../src/renderer/shared/api/backend-api.ts"
import { EntityReadError } from "@locus/client"
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { resolve, reject, promise }
}
const fields = []
const helperContext = { kind: "field", fragment: "", reference: "", field_range: { start: 1, end: 1 },
  condition_range: { start: 0, end: 1 } }
const source = (text = "") => ({
  format: "locus-native-tantivy-0.26",
  version: 2,
  text,
})
const draft = (text = "", name = "") => ({ name, source: source(text) })
test("raw input preserves untouched CRLF, Unicode and exact lexemes", async () => {
  const { displaySource, editSource, diagnosticPosition } =
    await import("../src/renderer/features/entity-filter/model/raw-input.ts")
  const text = "中文😀\r\ncount:18446744073709551615\rnext\nlast"
  assert.equal(editSource(text, displaySource(text)), text)
  assert.equal(editSource(text, ` ${displaySource(text)}`), ` ${text}`)
  assert.equal(editSource(text, displaySource(text).replace("next", "after")), text.replace("next", "after"))
  assert.equal(diagnosticPosition(text, new TextEncoder().encode("中文😀\r\n").length), 5)
})
function fixture(overrides = {}) {
  let released = []
  const observation = (ids, context = "context", expiry = 600) => ({
    entities: suppliedSequence(ids),
    context,
    generation: "generation",
    coveredSequence: "5",
    expiresAfterSeconds: expiry,
    release: async () => {
      released.push(context)
    },
  })
  const api = {
    identities: async () => suppliedSequence(["a", "b"]),
    search: async () => observation(["a"]),
    searchCatalogue: async () => ({ fields }),
    searchStatus: async () => ({ usable: true, state: "ready" }),
    searchEvidence: async ({ entities }) =>
      entities.map((entity) => ({ entity, matches: [{ field: "tags" }] })),
    searchMaintenance: async () => {},
    filterLanguage: async () => ({
      format: "locus-native-tantivy-0.26",
      version: 2,
      syntax: [],
    }),
    filterPresets: async () => [],
    filterAnalyze: async (source) => ({
      source,
      state: source.text === "unknown:value" ? "invalid" : source.text.trim() ? "valid" : "empty",
      diagnostics:
        source.text === "unknown:value"
          ? [{ start: 0, end: source.text.length, message: "Unknown field" }]
          : [],
      parsed: null,
    }),
    filterWrite: async ({ change }) => ({
      status: "filter_saved",
      preset: {
        id: "saved",
        revision: "r1",
        name: change.name,
        source: change.source,
      },
    }),
    filterPreset: async (id) => ({
      id,
      revision: "r1",
      name: id,
      source: source("loaded"),
    }),
    submission: async () => ({ status: "direct_pending" }),
    ...overrides,
  }
  const coordinator = new FilterCoordinator(api)
  return { api, c: coordinator, released, observation }
}

test("header search composes with applied Filter, preserves OR scope and saves only the Filter", async t => {
  const queries = [], writes = []
  const f = fixture()
  t.after(() => f.c.dispose())
  f.api.search = async source => { queries.push(source.text); return f.observation(["a"]) }
  const write = f.api.filterWrite
  f.api.filterWrite = async value => { writes.push(value.change); return write(value) }
  await f.c.refresh()
  f.c.show(); f.c.edit(draft("red OR blue")); await f.c.apply()
  f.c.show(); f.c.edit(draft("unapplied")); f.c.close()
  f.c.editSearch("portrait"); await f.c.applySearch()
  assert.equal(queries.at(-1), "(portrait) AND (red OR blue)")
  assert.equal(f.c.draft.source.text, "unapplied", "search does not apply or overwrite a modal draft")
  assert.equal(f.c.appliedFilter.text, "red OR blue")
  f.c.show(); f.c.edit(draft("green", "Green")); await f.c.save("Green")
  assert.equal(writes[0].source.text, "green")
  assert.equal(queries.at(-1), "(portrait) AND (green)")
  await f.c.refresh()
  assert.equal(queries.at(-1), "(portrait) AND (green)")
  f.c.editSearch(""); await f.c.applySearch()
  assert.equal(queries.at(-1), "green")
  assert.equal(f.c.appliedSearch, "")
  f.c.show(); f.c.clear(); await f.c.apply()
  assert.equal(f.c.filtered, false)
  assert.equal(f.c.sequence.length, 2)
})

test("clearing Filter keeps search; failed and late searches retain correctly attributed results", async t => {
  const f = fixture(), held = deferred(), queries = []
  t.after(() => f.c.dispose())
  f.api.search = async source => { assert.deepEqual(Object.keys(source).sort(), ["format", "text", "version"], "help metadata is not query input"); queries.push(source.text); if (source.text === "old") return held.promise; if (source.text === "broken") throw Error("Search read failed"); return f.observation([source.text]) }
  f.c.editSearch("first"); await f.c.applySearch()
  f.c.show(); f.c.edit(draft("kind:image")); await f.c.apply()
  f.c.show(); f.c.clear(); await f.c.apply()
  assert.equal(queries.at(-1), "first")
  assert.equal(f.c.filterApplied, false)
  f.c.editSearch("old"); const previous = f.c.applySearch()
  f.c.editSearch("new"); await f.c.applySearch()
  held.resolve(f.observation(["old"], "obsolete")); await previous
  assert.equal(f.c.sequence.at(0), "new")
  assert(f.released.includes("obsolete"))
  f.c.editSearch("broken"); await f.c.applySearch()
  assert.equal(f.c.sequence.at(0), "new")
  assert.equal(f.c.appliedSearch, "new")
  assert.equal(f.c.searchDraft, "broken")
  assert.match(f.c.searchError, /Search read failed/)
})

test("host close abandons pending header search and cancellation permits retry", async t => {
  const held = deferred(), requested = deferred(), f = fixture()
  t.after(() => f.c.dispose())
  await f.c.refresh()
  f.api.search = () => { requested.resolve(); return held.promise }
  f.c.editSearch("portrait"); const work = f.c.applySearch()
  await requested.promise
  f.c.host(true)
  held.resolve(f.observation(["late"], "closed-search")); await work
  assert.equal(f.c.pending, undefined)
  assert.equal(f.c.sequence.length, 2)
  assert(f.released.includes("closed-search"))
  f.c.host(false); f.api.search = async () => f.observation(["retry"])
  assert.equal(await f.c.applySearch(), true)
  assert.equal(f.c.sequence.at(0), "retry")
})
test("pending helper submission protects its source and rejects a later visit", async () => {
  const lexical = deferred()
  let writes = 0
  const { c } = fixture({ filterEditing: () => lexical.promise,
    filterHelp: async () => ({ guidance: "help", examples: [] }),
    filterWrite: async () => { writes++; throw new Error("must not write") } })
  c.show()
  c.assistance.input("@", 1, 0)
  const saving = c.save("pending")
  assert(c.busy)
  c.assistance.input("@changed", 8)
  c.edit(draft("changed"))
  c.requestSwitch(null)
  assert.equal(c.draft.source.text, "@")
  assert(c.assistance.active)
  c.close(); c.show()
  lexical.resolve(helperContext)
  assert.equal(await saving, false)
  assert.equal(writes, 0)
  assert.equal(c.draft.source.text, "@")
  assert(c.open)
  c.dispose()
})
test("naming preparation is qualified before delayed helper completion", async () => {
  const lexical = deferred()
  const { c } = fixture({ filterEditing: () => lexical.promise, filterHelp: async () => ({ guidance: "help", examples: [] }) })
  c.show(); c.assistance.input("@", 1, 0)
  const naming = c.prepareHelperAction()
  assert(c.busy)
  c.close(); c.show()
  lexical.resolve(helperContext)
  assert.equal(await naming, false)
  assert.equal(c.draft.source.text, "@")
  c.dispose()
})
test("delayed selected literal and Close cannot apply into a reopened visit", async () => {
  const literal = deferred()
  let searches = 0
  const { c } = fixture({
    filterEditing: async () => ({ kind: "value", fragment: "", field: "tag_names", reference: "tag_names_exact",
      field_range: { start: 1, end: 16 }, value_range: { start: 17, end: 17 }, condition_range: { start: 0, end: 17 } }),
    filterHelp: async () => ({ guidance: "help", examples: [] }), filterLiteral: () => literal.promise,
    searchObservation: async () => ({ context: "c", expires_after_seconds: 600 }),
    searchStrings: async () => ({ values: ["chosen"], no_values: false }),
    releaseSearchObservation: async () => {}, search: async () => { searches++; throw new Error("must not search") },
  })
  c.show()
  c.assistance.fields = [{ id: "tag_names", native_exact: "tag_names_exact", native_value: "tag_names", field_type: "text", assistance: "strings" }]
  c.assistance.input("@tag_names_exact:", 17, 0)
  await delay(0)
  const accepting = c.assistance.acceptValue("chosen"), applying = c.apply()
  assert(c.busy)
  c.close(); c.show()
  literal.resolve({ literal: '"chosen"' })
  assert.equal(await accepting, false)
  assert.equal(await applying, false)
  assert.equal(searches, 0)
  assert.equal(c.draft.source.text, "@tag_names_exact:")
  assert(c.open)
  c.dispose()
})
test("Apply publishes query and complete zero result, failure retains result/draft, Clear bypasses index/catalogue", async () => {
  const { c, api, observation } = fixture()
  await c.refresh()
  const initial = c.established
  c.show()
  c.edit(draft("broken"))
  api.search = async () => {
    throw Error("native syntax invalid")
  }
  assert.equal(await c.apply(), false)
  assert.equal(c.established, initial)
  assert.equal(c.open, true)
  assert.equal(c.draft.source.text, "broken")
  api.search = async () => observation([])
  assert.equal(await c.apply(), true)
  assert.equal(c.sequence.length, 0)
  assert.equal(c.established.criteria.text, "broken")
  assert.equal(c.open, false)
  c.clear()
  c.catalogue = undefined
  api.search = async () => {
    throw Error("unavailable")
  }
  assert.equal(await c.apply(), true)
  assert.equal(c.filtered, false)
  assert.equal(c.sequence.length, 2)
  c.dispose()
})
test("Close/reopen abandons late Apply and releases its context without closing the new editor", async () => {
  const held = deferred()
  const { c, released, observation } = fixture({ search: () => held.promise })
  await c.refresh()
  const old = c.established
  c.show()
  c.edit(draft("saved draft"))
  const pending = c.apply()
  await delay(0)
  c.close()
  c.show()
  held.resolve(observation(["late"], "abandoned"))
  assert.equal(await pending, false)
  assert.equal(c.open, true)
  assert.equal(c.established, old)
  assert.equal(c.draft.source.text, "saved draft")
  assert.deepEqual(released, ["abandoned"])
  c.dispose()
})
test("host close abandons Filter Apply; validation errors never claim a main-read failure", async () => {
  const held = deferred()
  const { c, observation, released } = fixture({ search: () => held.promise })
  await c.refresh()
  const established = c.established
  c.edit(draft("unknown:value"))
  assert.equal(await c.apply(), false)
  assert(c.error)
  assert.equal(c.resultError, undefined)
  c.edit(draft("q"))
  const pending = c.apply()
  await delay(0)
  c.host(true)
  held.resolve(observation(["a"], "host-abandoned"))
  await pending
  assert.equal(c.open, false)
  assert.equal(c.established, established)
  assert.deepEqual(released, ["host-abandoned"])
  c.show()
  assert.equal(c.open, false)
  c.host(false)
  c.show()
  assert.equal(c.open, true)
  c.dispose()
})
test("initial main failure survives draft edits and failed Apply until actual result success", async () => {
  const { c, api, observation } = fixture({
    identities: async () => {
      throw Error("Initial enumeration failed")
    },
    search: async () => {
      throw Error("Native syntax failed")
    },
  })
  await c.refresh()
  assert.equal(c.resultError, "Initial enumeration failed")
  c.edit(draft("q"))
  assert.equal(c.resultError, "Initial enumeration failed")
  await c.apply()
  assert.equal(c.error, "Native syntax failed")
  assert.equal(c.resultError, "Initial enumeration failed")
  assert.equal(c.pending, undefined)
  api.search = async () => observation(["a"])
  await c.apply()
  assert.equal(c.resultError, undefined)
  c.dispose()
})
test("newer refresh invalidates Apply; newer Apply invalidates old refresh", async () => {
  const first = deferred(),
    second = deferred()
  const { c, api, observation } = fixture()
  await c.refresh()
  c.edit(draft("query"))
  api.search = () => first.promise
  const applying = c.apply()
  await delay(0)
  const refreshing = c.refresh()
  await refreshing
  first.resolve(observation(["old"]))
  await applying
  assert.equal(c.filtered, false)
  api.identities = () => second.promise
  const oldRefresh = c.refresh()
  api.search = async () => observation(["new"])
  await c.apply()
  second.resolve(suppliedSequence(["stale"]))
  await oldRefresh
  assert.equal(c.sequence.at(0), "new")
  assert.equal(c.established.criteria.text, "query")
  c.dispose()
})
test("evidence expiry/release and maintenance cannot replace IDs; bounded evidence uses original context", async () => {
  const calls = []
  const { c, api, observation, released } = fixture()
  api.search = async () => observation(["a"], "original", 0.02)
  api.searchEvidence = async (request) => {
    calls.push(request)
    return [{ entity: "a", matches: [{ condition: "missing" }] }]
  }
  c.edit(draft("q"))
  await c.apply()
  const sequence = c.sequence
  await c.readEvidence("a")
  assert.deepEqual(calls, [{ context: "original", entities: ["a"] }])
  assert.equal(c.evidence.value.matches[0].condition, "missing")
  await c.maintain("rebuild")
  await delay(30)
  assert.equal(c.evidenceExpired, true)
  assert.equal(c.sequence, sequence)
  assert(released.includes("original"))
  c.dispose()
})
test("released backend context and stale evidence completion retain the fixed result", async () => {
  const { c, api, observation } = fixture()
  const held = deferred()
  c.edit(draft("q"))
  await c.apply()
  const sequence = c.sequence
  api.searchEvidence = async () => {
    throw new ApiFailure({ code: "unavailable", message: "expired" }, 410)
  }
  await c.readEvidence("a")
  assert.equal(c.evidenceExpired, true)
  assert.equal(c.sequence, sequence)
  await c.apply()
  api.searchEvidence = () => held.promise
  const evidence = c.readEvidence("a")
  api.search = async () => observation(["b"], "new")
  await c.apply()
  held.resolve([{ entity: "a", matches: [] }])
  await evidence
  assert.equal(c.evidence, undefined)
  assert.equal(c.sequence.at(0), "b")
  c.dispose()
})
test("native transfer errors expose backend syntax reason and presence validates target identity", async () => {
  assert.equal(
    errorText(
      new EntityReadError("HTTP failure", new Response(null, { status: 400 }), {
        code: "query",
        message: "Tantivy syntax: bad field",
      }),
    ),
    "Tantivy syntax: bad field",
  )
  assert.equal(
    await BackendApi.prototype.entityPresent.call(
      { memberships: async () => [{ entity_id: "x", status: "present" }] },
      "x",
    ),
    true,
  )
  await assert.rejects(
    BackendApi.prototype.entityPresent.call(
      { memberships: async () => [{ entity_id: "y", status: "present" }] },
      "x",
    ),
    /match/,
  )
})
test("direct singleton, related roundtrip, failed main read and stale return preserve contextual meaning", () => {
  const main = { mode: "grid", collectionId: "library", entityId: "a" }
  const direct = entitySearch(directDestination("excluded", main))
  const sequence = contextSequence(direct, suppliedSequence([]), [], suppliedSequence)
  assert.equal(sequence.length, 1)
  assert.equal(sequence.at(0), "excluded")
  assert.equal(adjacentId(sequence, "excluded", 1), undefined)
  const collection = {
    id: "gallery",
    viewId: "civitai",
    entityIds: ["preview"],
  }
  const related = relatedDestination(direct, collection, "preview")
  const back = resolveReturn(related, suppliedSequence([]), [collection], suppliedSequence, false).destination
  assert.equal(back.direct, true)
  assert.equal(back.entityId, "excluded")
  assert.equal(resolveReturn(direct, suppliedSequence(["a"]), [], suppliedSequence).destination.entityId, "a")
  assert.equal(
    resolveReturn(direct, suppliedSequence([]), [], suppliedSequence).destination.entityId,
    undefined,
  )
  assert.equal(
    resolveReturn(direct, suppliedSequence([]), [], suppliedSequence, false).destination.entityId,
    "a",
  )
  const ordinary = inspectionDestination({ ...main, restoreMain: true }, "far")
  const exit = resolveReturn(ordinary, suppliedSequence(["a", "far"]), [], suppliedSequence).destination
  assert.equal(exit.entityId, "far")
  assert.equal(exit.restoreMain, undefined)
  assert.equal(
    contextSequence(
      { mode: "inspect", collectionId: "missing", entityId: "a" },
      suppliedSequence(["a"]),
      [],
      suppliedSequence,
    ),
    undefined,
  )
})

test("Save keeps the entire pipeline busy and dirty guard Save applies before New without closure", async () => {
  const held = deferred()
  const { c, api } = fixture({ filterAnalyze: () => held.promise })
  c.show()
  c.edit(draft("query", "Keep"))
  const pending = c.save()
  await delay(0)
  assert.equal(c.busy, true)
  c.edit(draft("unexpected"))
  assert.equal(c.draft.source.text, "query")
  held.resolve({
    source: source("query"),
    state: "valid",
    diagnostics: [],
    parsed: null,
  })
  await pending
  assert.equal(c.filtered, true)
  assert.equal(c.open, false)
  c.show()
  c.edit(draft("next", "Keep"))
  api.filterAnalyze = async (source) => ({
    source,
    state: "valid",
    diagnostics: [],
    parsed: null,
  })
  c.requestSwitch(null)
  await c.resolveGuard("save")
  assert.equal(c.open, true)
  assert.equal(c.busy, false)
  assert.equal(c.draft.source.text, "")
  assert.equal(c.established.criteria.text, "next")
  c.dispose()
})
test("A failed Save supersedes a held Refresh without leaving pending state; late save cannot start a query over newer refresh", async () => {
  const refresh = deferred(),
    save = deferred()
  const { c, api } = fixture()
  await c.refresh()
  c.show()
  api.identities = () => refresh.promise
  const old = c.refresh()
  c.edit(draft("saved", "Name"))
  api.filterWrite = async () => ({
    status: "filter_failed",
    reason: "conflict",
    message: "changed",
    uncertain: false,
  })
  await c.save()
  refresh.resolve(suppliedSequence(["old"]))
  await old
  assert.equal(c.pending, undefined)
  let queries = 0
  api.search = async () => {
    queries++
    throw Error("must not run")
  }
  api.filterWrite = () => save.promise
  api.identities = async () => suppliedSequence(["new"])
  const saving = c.save()
  await c.refresh()
  save.resolve({
    status: "filter_saved",
    preset: {
      id: "saved",
      name: "Name",
      revision: "2",
      source: source("saved"),
    },
  })
  await saving
  assert.equal(queries, 0)
  assert.equal(c.sequence.at(0), "new")
  assert.equal(c.pending, undefined)
  c.dispose()
})
test("late durable save reports receipt without changing a newer visit or draft", async () => {
  const save = deferred()
  const { c } = fixture({ filterWrite: () => save.promise })
  c.show()
  c.edit(draft("old", "Old"))
  const pending = c.save()
  c.close()
  c.show()
  c.edit(draft("new", "New"))
  save.resolve({
    status: "filter_saved",
    preset: { id: "old", name: "Old", revision: "1", source: source("old") },
  })
  await pending
  assert.equal(c.open, true)
  assert.equal(c.draft.name, "New")
  assert.equal(c.saved, undefined)
  assert.match(c.notice, /Saved/)
  c.dispose()
})
test("uncertain preset mutations use read reconciliation without replay", async () => {
  let writes = 0
  const { c, api } = fixture({
    filterWrite: async () => {
      writes++
      throw Error("connection closed")
    },
  })
  c.show()
  c.edit(draft("x", "Name"))
  await c.save()
  assert(c.uncertain)
  assert.equal(c.saved, undefined)
  api.submission = async () => ({
    status: "direct_complete",
    outcome: {
      status: "filter_saved",
      preset: { id: "x", name: "Name", revision: "1", source: source("x") },
    },
  })
  await c.reconcile()
  assert.equal(c.uncertain, undefined)
  assert.equal(writes, 1)
  assert.equal(c.saved, undefined)
  c.saved = { id: "x", name: "Name", revision: "1", source: source("x") }
  await c.rename("Rename")
  assert(c.uncertain)
  c.dispose()
})

test("blank-name Save does not supersede Refresh and preset list replies respect observation order", async () => {
  const held = deferred(),
    oldList = deferred()
  const { c, api } = fixture()
  await c.refresh()
  c.show()
  api.identities = () => held.promise
  const refreshing = c.refresh()
  c.edit(draft("source"))
  assert.equal(await c.save(), false)
  held.resolve(suppliedSequence(["fresh"]))
  await refreshing
  assert.equal(c.pending, undefined)
  assert.equal(c.sequence.at(0), "fresh")
  api.filterPresets = () => oldList.promise
  const old = c.readPresets()
  api.filterPresets = async () => [{ id: "new", name: "New", revision: "1" }]
  await c.readPresets()
  oldList.resolve([])
  await old
  assert.equal(c.presets[0].id, "new")
  c.dispose()
})

test("managing an unloaded preset leaves the selected draft and result association intact", async () => {
  const { c, api } = fixture()
  c.show()
  const selected = { id: "selected", name: "Selected", revision: "1", source: source("selected") }
  c.saved = selected
  c.edit(draft("edited", "Draft name"))
  const before = c.draft
  const foreign = { id: "foreign", name: "Foreign", revision: "2" }
  api.filterWrite = async body => {
    assert.equal(body.change.id, "foreign")
    assert.equal(body.change.revision, "2")
    return body.change.operation === "rename"
      ? { status: "filter_saved", preset: { ...foreign, name: "Renamed", source: source("foreign") } }
      : { status: "filter_deleted" }
  }
  await c.rename("Renamed", foreign)
  assert.equal(c.saved, selected)
  assert.equal(c.draft, before)
  await c.deletePreset(foreign)
  assert.equal(c.saved, selected)
  assert.equal(c.draft, before)
  c.dispose()
})

test("Rename preserves unsaved name/source and late unknown writes retain separate reconciliation identities", async () => {
  const { c, api } = fixture()
  c.show()
  c.saved = { id: "saved", name: "Saved", revision: "1", source: source("saved") }
  c.edit(draft("edited", "Draft name"))
  api.filterWrite = async () => ({
    status: "filter_saved",
    preset: { id: "saved", name: "Renamed", revision: "2", source: source("saved") },
  })
  await c.rename("Renamed")
  assert.equal(c.draft.name, "Draft name")
  assert.equal(c.draft.source.text, "edited")
  assert(c.dirty)
  const first = deferred(),
    second = deferred()
  api.filterWrite = () => first.promise
  const one = c.save()
  c.close()
  c.show()
  api.filterWrite = () => second.promise
  const two = c.save()
  second.reject(Error("second transport loss"))
  await two
  first.reject(Error("first transport loss"))
  await one
  assert.equal(c.uncertainWrites.length, 2)
  const selected = c.uncertainWrites[0].request
  api.submission = async () => ({
    status: "direct_complete",
    outcome: { status: "filter_failed", reason: "conflict", message: "changed", uncertain: false },
  })
  await c.reconcile(selected)
  assert.equal(c.uncertainWrites.length, 1)
  assert.notEqual(c.uncertain.request, selected)
  c.dispose()
})

test("guarded Save outcomes retain preset attribution after New", async () => {
  for (const [text, failure] of [
    ["unknown:value", false],
    ["entity_id:*", true],
  ]) {
    const { c, api } = fixture()
    await c.refresh()
    const old = c.established
    c.show()
    c.edit(draft(text, "Named attempt"))
    if (failure)
      api.search = async () => {
        throw Error("Index unavailable")
      }
    c.requestSwitch(null)
    await c.resolveGuard("save")
    assert.equal(c.draft.source.text, "")
    assert.equal(c.established, old)
    assert.match(c.notice, /Named attempt/)
    assert.match(c.notice, failure ? /not applied: Index unavailable/ : /with problems: Unknown field/)
    assert.equal(c.open, true)
    c.dispose()
  }
})

test("generated Tag drafts use dirty guard, clear saved association and wait Apply", async () => {
  const { c } = fixture()
  c.show(); await delay(0)
  c.edit(draft("old", "Old preset"));
  const old = c.draft
  assert(c.generatedDraftReceiver()(source('tag_subtree:"root"')))
  assert.equal(c.draft, old); assert(c.guard)
  await c.resolveGuard("cancel"); assert.equal(c.draft, old)
  assert(c.generatedDraftReceiver()(source('tag_ids:"root"')))
  await c.resolveGuard("discard")
  assert.equal(c.saved, undefined); assert.equal(c.draft.name, ""); assert.equal(c.draft.source.text, 'tag_ids:"root"')
  assert.equal(c.established, undefined)
  const stale = c.generatedDraftReceiver(); c.edit(draft("newer")); assert.equal(stale(source("late")), false)
  c.saving = true; assert.equal(c.generatedDraftReceiver(), undefined);c.saving = false;c.dispose()
})

test("Tag handoff guard Save applies old source then adopts fresh unsaved source; stale Save cannot adopt", async () => {
 const { c } = fixture(); c.show(); await delay(0)
 c.edit(draft("old content", "Old preset"))
 assert(c.generatedDraftReceiver()(source('tag_subtree:"root"')))
 await c.resolveGuard("save")
 assert.equal(c.open,true);assert.equal(c.saved,undefined);assert.equal(c.draft.name,"")
 assert.equal(c.draft.source.text,'tag_subtree:"root"');assert.equal(c.established.criteria.text,"old content")
 c.dispose()
 const pending=deferred(), f=fixture({filterWrite:()=>pending.promise});f.c.show();await delay(0)
 f.c.edit(draft("old", "Save old"));assert(f.c.generatedDraftReceiver()(source("late root")))
 const saving=f.c.resolveGuard("save");await delay(0);f.c.close();f.c.show()
 pending.resolve({status:"filter_saved",preset:{id:"saved",revision:"one",name:"Save old",source:source("old")}})
 await saving;assert.equal(f.c.draft.source.text,"old");f.c.dispose()
})
