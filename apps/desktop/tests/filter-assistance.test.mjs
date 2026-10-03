import assert from "node:assert/strict"
import { test } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { FilterAssistance } from "../src/renderer/features/entity-filter/model/assistance.ts"
import { bytePosition, byteToRaw } from "../src/renderer/features/entity-filter/model/raw-input.ts"
import { ApiFailure } from "../src/renderer/shared/api/backend-api.ts"
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { resolve, reject, promise }
}
const field = { id: "tag_names", native_exact: "tag_names_exact", native_value: "tag_names",
  assistance: "strings", field_type: "text", owner: "Tag", shape: "collection" }
const fieldContext = { kind: "field", fragment: "", reference: "", field: null,
  field_range: { start: 1, end: 1 }, condition_range: { start: 0, end: 1 } }
const valueContext = { kind: "value", fragment: "", reference: "tag_names_exact", field: "tag_names",
  field_range: { start: 1, end: 16 }, separator_range: { start: 16, end: 17 },
  value_range: { start: 17, end: 17 }, condition_range: { start: 0, end: 17 } }
function fixture(overrides = {}) {
  let source = { format: "native", version: 2, text: "" }, captures = 0, releases = [], literals = []
  const api = {
    filterEditing: async () => valueContext,
    filterHelp: async (request) => ({ reference: request.field ?? "", examples: [], guidance: "Native help" }),
    filterLiteral: async (request) => { literals.push(request); return { literal: '"chosen"' } },
    searchObservation: async () => ({ context: `context-${++captures}`, expires_after_seconds: 600 }),
    searchStrings: async () => ({ values: ["chosen"], no_values: false }),
    searchBounds: async () => ({ minimum: null, maximum: null }),
    releaseSearchObservation: async (context) => { releases.push(context) },
    ...overrides,
  }
  const a = new FilterAssistance(api, () => source, (text) => { source = { ...source, text } }, () => {})
  a.fields = [field]
  return { a, api, source: () => source, captures: () => captures, releases, literals }
}
test("byte/display conversion preserves Unicode and untouched CRLF", () => {
  const source = "中文😀\r\n@tag_names:"
  const bytes = bytePosition(source, 5)
  assert.equal(byteToRaw(source, bytes), 6)
  assert.equal(source.slice(byteToRaw(source, bytes)), "@tag_names:")
  assert.throws(() => byteToRaw(source, 1))
})
test("fresh direct provenance survives fast typing and rejects stale lexical replies", async () => {
  const first = deferred(), second = deferred()
  let calls = 0
  const f = fixture({ filterEditing: () => ++calls === 1 ? first.promise : second.promise })
  f.a.input("@", 1, 0)
  f.a.input("@ta", 3)
  assert.equal(f.a.session.lookupRequested, false, "Delayed eligibility must not steal focus from continued source editing")
  first.resolve(fieldContext)
  await delay(0)
  assert.equal(f.a.context, undefined)
  second.resolve({ ...fieldContext, fragment: "ta", reference: "ta", field_range: { start: 1, end: 3 } })
  await delay(0)
  assert.equal(f.a.context.fragment, "ta")
  assert(f.a.active)
  f.a.exit()
  f.a.input("@loaded", 7)
  assert(!f.a.active)
})

test("typing retains presentation without accepting stale values or repeating identical caret requests", async (t) => {
  let editingCalls = 0, helpCalls = 0
  const nextContext = deferred(), nextPage = deferred()
  const f = fixture({
    filterEditing: () => ++editingCalls === 1 ? Promise.resolve(valueContext) : nextContext.promise,
    filterHelp: async () => { helpCalls++; return { guidance: "Keep this help", examples: [] } },
  })
  t.after(() => f.a.exit())
  f.a.input("@tag_names_exact:", 17, 0)
  await delay(0)
  const help = f.a.help
  f.api.searchStrings = () => nextPage.promise
  f.a.input("@tag_names_exact:n", 18)
  f.a.caret(18)
  assert.equal(editingCalls, 2, "The input and selection event share one owner request")
  assert.equal(f.a.context, valueContext)
  assert.deepEqual(f.a.observed, ["chosen"])
  assert.equal(f.a.help, help)
  assert.equal(await f.a.acceptValue("chosen"), false)
  assert.equal(f.a.acceptHighlighted(), false)
  nextContext.resolve({ ...valueContext, fragment: "n", value_range: { start: 17, end: 18 } })
  await delay(0)
  assert(f.a.loading)
  assert.deepEqual(f.a.observed, ["chosen"])
  assert.equal(await f.a.acceptValue("chosen"), false)
  assert.equal(helpCalls, 1, "Unchanged field help is reused while typing")
  nextPage.resolve({ values: ["new"], no_values: false })
  await delay(0)
  assert.deepEqual(f.a.observed, ["new"])
  assert.equal(f.a.loading, false)
  assert.equal(f.a.candidateCount, 1)
  f.a.exit()
})
test("completion waits for owner eligibility and preserves an ineligible literal marker", async () => {
  const owner = deferred(), f = fixture({ filterEditing: () => owner.promise })
  f.a.input('"@', 2, 1)
  const complete = f.a.complete()
  assert.equal(f.source().text, '"@')
  owner.resolve({ kind: "indeterminate", fragment: "" })
  await complete
  assert.equal(f.source().text, '"@')
  assert(!f.a.active)
})
test("requested literal acceptance finishes before completion; failure preserves source", async () => {
  const literal = deferred(), f = fixture({ filterLiteral: () => literal.promise })
  f.a.input("@tag_names_exact:", 17, 0)
  await delay(0)
  const accept = f.a.acceptValue("chosen"), complete = f.a.complete()
  assert.equal(f.source().text, "@tag_names_exact:")
  literal.resolve({ literal: '"chosen"' })
  await accept; await complete
  assert.equal(f.source().text, 'tag_names_exact:"chosen"')
  const rejected = fixture({ filterLiteral: async () => { throw new Error("generation failed") } })
  rejected.a.input("@tag_names_exact:", 17, 0)
  await delay(0)
  const accepting = rejected.a.acceptValue("chosen"), finishing = rejected.a.complete()
  await accepting
  assert.equal(await finishing, false)
  assert.equal(rejected.source().text, "@tag_names_exact:")
  rejected.a.exit()
})
test("an observation is reused across edits, failure stays unavailable until explicit refresh", async () => {
  const f = fixture()
  f.a.input("@tag_names_exact:", 17, 0)
  await delay(0)
  assert.equal(f.captures(), 1)
  f.a.input("@tag_names_exact:c", 18)
  await delay(0)
  assert.equal(f.captures(), 1)
  f.api.searchStrings = async () => { throw new Error("expired") }
  f.a.input("@tag_names_exact:ca", 19)
  await delay(0)
  assert.match(f.a.error, /expired/)
  f.a.input("@tag_names_exact:cat", 20)
  await delay(0)
  assert.equal(f.captures(), 1)
  assert.deepEqual(f.a.observed, [])
  assert.match(f.a.error, /expired/)
  f.api.searchStrings = async () => ({ values: ["new"], no_values: false })
  f.a.refresh()
  await delay(0)
  assert.equal(f.captures(), 2)
  assert.deepEqual(f.a.observed, ["new"])
  f.a.exit()
  assert.deepEqual(f.releases, ["context-1", "context-2"])
})
test("expiry removes selectable observed values and never silently captures on typing", async () => {
  let captures = 0
  const f = fixture({ searchObservation: async () => ({ context: `c${++captures}`, expires_after_seconds: 0.01 }) })
  f.a.input("@tag_names_exact:", 17, 0)
  await delay(30)
  assert.match(f.a.error, /expired/)
  assert.equal(f.a.observed.length, 0)
  f.a.input("@tag_names_exact:c", 18)
  await delay(0)
  assert.equal(captures, 1)
  f.a.exit()
})
test("late help and values cannot repopulate a departed helper", async () => {
  const help = deferred(), page = deferred()
  const f = fixture({ filterHelp: () => help.promise, searchStrings: () => page.promise })
  f.a.input("@tag_names_exact:", 17, 0)
  await delay(0)
  f.a.exit()
  help.resolve({ guidance: "obsolete", examples: [] }); page.resolve({ values: ["obsolete"] })
  await delay(0)
  assert.equal(f.a.help, undefined)
  assert.equal(f.a.observed.length, 0)
  assert.equal(f.source().text, "@tag_names_exact:")
})
test("identifier candidates use their native value tag and field previews use a real catalogue reference", async () => {
  let requestedHelp
  const f = fixture({ filterHelp: async (request) => { requestedHelp = request; return { guidance: "help", examples: [] } } })
  f.a.fields = [{ ...field, field_type: "identifier" }]
  f.a.input("@tag_names_exact:", 17, 0)
  await delay(0)
  await f.a.acceptValue("chosen")
  assert.equal(f.literals[0].value.type, "identifier")
  f.a.exit()
  f.api.filterEditing = async () => ({ ...fieldContext, fragment: "ta", reference: "ta", field_range: { start: 1, end: 3 } })
  f.a.input("@ta", 3, 0)
  await delay(0)
  assert.equal(requestedHelp.field, "tag_names_exact")
  f.a.exit()
  f.api.filterEditing = async () => ({ ...fieldContext, fragment: "unknown", reference: "unknown" })
  f.a.input("@unknown", 8, 0)
  await delay(0)
  f.a.setLookup("unknown")
  await delay(0)
  assert.equal(requestedHelp.field, undefined)
  f.a.exit()
})

test("field examples follow keyboard highlight and reject an older preview reply", async (t) => {
  const first = deferred(), second = deferred(), requested = []
  const f = fixture({ filterEditing: async () => fieldContext,
    filterHelp: (request) => { requested.push(request.field); return request.field === "tag_names_exact" ? first.promise : second.promise } })
  t.after(() => f.a.exit())
  f.a.fields = [field, { ...field, id: "file_name", native_exact: "file_name_exact", native_value: "file_name" }]
  f.a.input("@", 1, 0)
  await delay(0)
  assert(f.a.move(1))
  assert.deepEqual(requested, ["tag_names_exact", "file_name_exact"])
  second.resolve({ reference: "file_name_exact", examples: ['file_name_exact:"name"'], guidance: "Current preview" })
  await delay(0)
  first.resolve({ reference: "tag_names_exact", examples: ['tag_names_exact:"tag"'], guidance: "Old preview" })
  await delay(0)
  assert.equal(f.a.help.reference, "file_name_exact")
  assert.equal(f.source().text, "@", "Previewing must not insert a field")
  assert.equal(f.captures(), 0, "Field previews do not start library discovery")
  f.a.move(-1)
  assert.equal(f.a.help.reference, "tag_names_exact", "a warmed field example is available synchronously")
  f.a.move(1)
  assert.equal(f.a.help.reference, "file_name_exact")
  assert.deepEqual(requested, ["tag_names_exact", "file_name_exact"], "moving back does not repaint a loading preview or repeat help reads")
})
test("an exact declared choice leads matching suggestions and keeps observed provenance", async () => {
  const f = fixture({ filterEditing: async () => ({ ...valueContext, fragment: "Jpeg" }),
    searchStrings: async () => ({ values: ["Jpeg"], no_values: false }) })
  f.a.fields = [{ ...field, choices: { closed: true, values: ["Png", "Jpeg", "WebP", "Gif"] } }]
  f.a.input("@tag_names_exact:", 17, 0)
  await delay(0)
  f.a.setLookup("^Jpeg$")
  await delay(0)
  assert.deepEqual(f.a.candidates, [{ value: "Jpeg", declared: true, observed: true }])
  assert(f.a.acceptHighlighted())
  await delay(0)
  assert.equal(f.literals[0].value.value, "Jpeg")
  f.a.exit()
})
test("editing failure retries the exact source; pending ineligible Enter remains a newline", async () => {
  const f = fixture({ filterEditing: async () => { throw new Error("editing outage") } })
  f.a.input("@tag_names_exact:", 17, 0)
  await delay(0)
  assert.match(f.a.error, /editing outage/)
  f.api.filterEditing = async () => valueContext
  f.a.retry()
  await delay(0)
  assert.equal(f.a.context.kind, "value")
  f.a.exit()
  const lexical = deferred(), literal = fixture({ filterEditing: () => lexical.promise })
  literal.a.input('"@', 2, 1)
  const enter = literal.a.enter(2, 2)
  lexical.resolve({ kind: "indeterminate", fragment: "" })
  await enter
  assert.equal(literal.source().text, '"@\n')
})
test("departed literal generation cannot block a new helper's completion", async () => {
  const literal = deferred(), f = fixture({ filterLiteral: () => literal.promise })
  f.a.input("@tag_names_exact:", 17, 0)
  await delay(0)
  const obsolete = f.a.acceptValue("chosen")
  f.a.exit()
  f.api.filterEditing = async () => fieldContext
  f.a.input("@", 1, 0)
  assert.equal(await f.a.complete(), true)
  assert.equal(f.source().text, "")
  literal.resolve({ literal: '"obsolete"' })
  assert.equal(await obsolete, false)
  assert.equal(f.source().text, "")
})
test("a newer candidate selection supersedes an older literal request for the same edit", async () => {
  const first = deferred(), second = deferred()
  let calls = 0
  const f = fixture({ filterLiteral: () => ++calls === 1 ? first.promise : second.promise,
    searchStrings: async () => ({ values: ["first", "second"], no_values: false }) })
  f.a.input("@tag_names_exact:", 17, 0)
  await delay(0)
  const old = f.a.acceptValue("first"), latest = f.a.acceptValue("second")
  first.resolve({ literal: '"first"' })
  assert.equal(await old, false)
  assert.equal(f.source().text, "@tag_names_exact:")
  second.resolve({ literal: '"second"' })
  assert.equal(await latest, true)
  assert.equal(f.source().text, '@tag_names_exact:"second"')
  f.a.exit()
})

test("default regex field lookup stays transient and invalid input is recoverable", async (t) => {
  const f = fixture({ filterEditing: async () => fieldContext })
  t.after(() => f.a.exit())
  f.a.fields = ["bilibili_bvid", "bilibili_author_id", "bilibili_title", "twitter_post_id"].map((id) =>
    ({ ...field, id, native_exact: id, native_value: id }))
  f.a.input("@", 1, 0)
  await delay(0)
  f.a.setLookup("BILIBILI.*ID")
  assert.deepEqual(f.a.fieldCandidates.map((f) => f.id), ["bilibili_bvid", "bilibili_author_id"])
  assert.equal(f.source().text, "@")
  assert.deepEqual(f.a.activeRange, { start: 0, end: 1 })
  f.a.setLookup("[")
  assert.match(f.a.lookupError, /Invalid regex/)
  assert.equal(f.a.acceptHighlighted(), false)
  assert.equal(f.source().text, "@")
  f.a.setLookup("bilibili.*id")
  assert.equal(f.a.lookupError, undefined)
  assert.equal(f.a.fieldCandidates.length, 2)
  await f.a.complete()
  assert.equal(f.source().text, "")
  assert.equal(f.a.activeRange, undefined)
})

test("regex value intents reject old pages and literals without changing source or snapshots", async (t) => {
  const oldPage = deferred(), newPage = deferred(), literal = deferred(), requests = []
  const f = fixture({ filterLiteral: () => literal.promise,
    searchStrings: (request) => { requests.push(request); return request.fragment === "old" ? oldPage.promise : request.fragment === "new.*" ? newPage.promise : Promise.resolve({ values: ["chosen"] }) } })
  t.after(() => f.a.exit())
  f.a.input("@tag_names_exact:", 17, 0)
  await delay(0)
  const accepting = f.a.acceptValue("chosen")
  f.a.setLookup("old")
  f.a.setLookup("new.*")
  await delay(0)
  oldPage.resolve({ values: ["obsolete"], continuation: "obsolete-page" })
  literal.resolve({ literal: '"obsolete"' })
  assert.equal(await accepting, false)
  await delay(0)
  assert(f.a.loading)
  assert.equal(f.a.continuation, undefined)
  newPage.resolve({ values: ["new value"], continuation: "current-page" })
  await delay(0)
  assert.deepEqual(f.a.observed, ["new value"])
  assert.equal(f.source().text, "@tag_names_exact:")
  assert.equal(f.captures(), 1)
  assert(requests.every((r) => r.matching === "regex"))
  assert.equal(f.a.continuation, "current-page")
})

test("backend regex errors recover on editing without discarding the aligned observation", async (t) => {
  const f = fixture({ searchStrings: async (request) => {
    if (request.fragment === "(?=x)") throw new ApiFailure({ code: "invalid_request", message: "Invalid candidate regex: lookaround is unsupported" }, 400)
    return { values: ["chosen"] }
  } })
  t.after(() => f.a.exit())
  f.a.input("@tag_names_exact:", 17, 0)
  await delay(0)
  f.a.setLookup("(?=x)")
  await delay(0)
  assert.match(f.a.lookupError, /unsupported/)
  assert.equal(f.a.acceptHighlighted(), false)
  f.a.setLookup("cho.*")
  await delay(0)
  assert.equal(f.a.lookupError, undefined)
  assert.equal(f.a.candidateCount, 1)
  assert.equal(f.captures(), 1)
  assert.equal(f.source().text, "@tag_names_exact:")
})

test("query roots use complete primary vocabulary, name regex and identity literals without index capture", async () => {
 const identity="01992853-c123-7000-8000-000000000001"
 const context={kind:"value",field:"tag_subtree",reference:"tag_subtree",field_range:{start:1,end:12},separator_range:{start:12,end:13},value_range:{start:13,end:13},condition_range:{start:0,end:13},fragment:""}
 const f=fixture({filterEditing:async()=>context,filterReferenceChoices:async()=>[{identity,name:"Unused category"}],searchObservation:async()=>assert.fail("Primary roots must not require a ready index"),filterLiteral:async(request)=>{f.literals.push(request);return {literal:`"${request.value.value}"`}}})
 f.a.references=[{id:"tag_subtree",owner:"tag",target_field:"tag_ids",meaning:"inclusive_subtree"}]
 f.a.input("@tag_subtree:",13,0);await delay(0)
 assert.equal(f.a.candidates[0].label,"Unused category");assert.equal(f.a.candidates[0].value,identity)
 f.a.setLookup("unused.*");await delay(0);assert.equal(f.a.candidates.length,1)
 f.a.setLookup("[");assert.match(f.a.lookupError,/Invalid regex/);assert.equal(f.a.candidates.length,0)
 f.a.setLookup("");await delay(0);await f.a.acceptValue(identity)
 assert.equal(f.literals[0].value.type,"identifier");assert.equal(f.literals[0].value.value,identity)
 assert.equal(f.source().text,`@tag_subtree:"${identity}"`);f.a.exit()
})


function mixedDiscoveryFixture(overrides = {}) {
  const f = fixture({
    filterEditing: async ({ source }) => source.text.startsWith("@tag_subtree:")
      ? { kind: "value", field: "tag_subtree", reference: "tag_subtree", fragment: "",
          field_range: { start: 1, end: 12 }, separator_range: { start: 12, end: 13 },
          value_range: { start: 13, end: source.text.length }, condition_range: { start: 0, end: source.text.length } }
      : { ...valueContext, value_range: { start: 17, end: source.text.length }, condition_range: { start: 0, end: source.text.length } },
    filterReferenceChoices: async () => [{ identity: "01992853-c123-7000-8000-000000000001", name: "Unused root" }],
    ...overrides,
  })
  f.a.references = [{ id: "tag_subtree", owner: "tag", target_field: "tag_ids", meaning: "inclusive_subtree" }]
  const enter = async (text) => {
    f.a.input(text, text.length, f.a.active ? undefined : 0)
    await delay(0)
  }
  return { ...f, enter }
}

test("aligned expiry cannot cancel a pending primary root reply, but remains attributable when switching back", async (t) => {
  const pending = deferred()
  let captures = 0
  const f = mixedDiscoveryFixture({
    searchObservation: async () => ({ context: `aligned-${++captures}`, expires_after_seconds: 0.04 }),
    filterReferenceChoices: () => pending.promise,
  })
  t.after(() => f.a.exit())
  await f.enter("@tag_names_exact:")
  assert.deepEqual(f.a.observed, ["chosen"])
  await f.enter("@tag_subtree:")
  assert(f.a.loading)
  await delay(70)
  assert(f.a.loading, "Expiry of a different source cannot finish or invalidate this vocabulary request")
  assert.equal(f.a.error, undefined)
  assert.deepEqual(f.releases, ["aligned-1"])
  pending.resolve([{ identity: "root-id", name: "Unused root" }])
  await delay(0)
  assert.equal(f.a.loading, false)
  assert.equal(f.a.candidates[0].label, "Unused root")
  await f.enter("@tag_names_exact:")
  assert.match(f.a.error, /observation expired/)
  assert.deepEqual(f.a.observed, [])
  assert.equal(captures, 1, "Returning to an expired aligned observation does not silently replace it")
  f.a.refresh()
  await delay(0)
  assert.equal(captures, 2)
  assert.deepEqual(f.a.observed, ["chosen"])
})

test("aligned expiry preserves displayed primary candidates and pending stable identity acceptance", async (t) => {
  const literal = deferred()
  const f = mixedDiscoveryFixture({
    searchObservation: async () => ({ context: "aligned", expires_after_seconds: 0.04 }),
    filterLiteral: () => literal.promise,
  })
  t.after(() => f.a.exit())
  await f.enter("@tag_names_exact:")
  await f.enter("@tag_subtree:")
  const candidate = f.a.candidates[0]
  const accepting = f.a.acceptValue(candidate.value)
  await delay(70)
  assert.deepEqual(f.a.candidates, [candidate])
  assert.equal(f.a.error, undefined)
  literal.resolve({ literal: `"${candidate.value}"` })
  assert.equal(await accepting, true)
  assert.equal(f.source().text, `@tag_subtree:"${candidate.value}"`)
  assert.deepEqual(f.releases, ["aligned"])
})

test("primary failure and refresh neither release nor replace a usable aligned observation", async (t) => {
  const requests = []
  const f = mixedDiscoveryFixture({
    searchStrings: async (request) => { requests.push(request.context); return { values: ["chosen"] } },
    filterReferenceChoices: async () => { throw new Error("primary read failed") },
  })
  t.after(() => f.a.exit())
  await f.enter("@tag_names_exact:")
  await f.enter("@tag_subtree:")
  assert.match(f.a.error, /Reference vocabulary unavailable.*primary read failed/)
  assert.deepEqual(f.releases, [])
  await f.enter("@tag_names_exact:")
  assert.equal(f.a.error, undefined)
  assert.deepEqual(f.a.observed, ["chosen"])
  assert.equal(f.captures(), 1)
  await f.enter("@tag_subtree:")
  f.api.filterReferenceChoices = async () => [{ identity: "root-id", name: "Refreshed root" }]
  f.a.refresh()
  await delay(0)
  assert.equal(f.a.error, undefined)
  assert.equal(f.a.candidates[0].label, "Refreshed root")
  assert.deepEqual(f.releases, [])
  await f.enter("@tag_names_exact:")
  assert.deepEqual(requests, ["context-1", "context-1", "context-1"])
  assert.equal(f.captures(), 1)
  f.a.exit()
  assert.deepEqual(f.releases, ["context-1"], "Helper exit still retires its retained aligned context")
})

test("primary refresh does not clear an earlier aligned failure and cancels its own older literal acceptance", async (t) => {
  const literal = deferred()
  const f = mixedDiscoveryFixture({
    searchStrings: async () => { throw new Error("index discovery failed") },
    filterLiteral: () => literal.promise,
  })
  t.after(() => f.a.exit())
  await f.enter("@tag_names_exact:")
  assert.match(f.a.error, /index discovery failed/)
  await f.enter("@tag_subtree:")
  assert.equal(f.a.error, undefined)
  const accepting = f.a.acceptValue(f.a.candidates[0].value)
  f.a.refresh()
  await delay(0)
  literal.resolve({ literal: '"obsolete"' })
  assert.equal(await accepting, false)
  assert.equal(f.source().text, "@tag_subtree:")
  await f.enter("@tag_names_exact:")
  assert.match(f.a.error, /index discovery failed/)
  assert.equal(f.captures(), 1)
})
