import assert from "node:assert/strict"
import { test } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { CardCoverCoordinator } from "../src/renderer/features/entity-card-cover/model/card-cover.ts"

const origin = "origin", source = "source", target = "target", file = "file", image = "image"
const selection = { source_component_id: source, version_id: "10", target_entity_id: target, target_file_id: file, image_component_id: image }
const members = () => [{ entity_id: target, status: "present", memberships: [
  { kind_id: "9fd73d3d-d35d-41bc-8b73-402e12f5c017", component_id: file },
  { kind_id: "aadf84d2-0dc0-4a81-8cdb-901162c78321", component_id: image },
] }]
function fixture(overrides = {}, entityProjection) {
  let observed = { status: "unset", entity_id: origin }
  const calls = []
  const api = {
    cardCoverPreferences: async () => [observed], cardCoverPreference: async () => observed,
    civitai: async () => ({ input: "current", host: origin, record: { component_id: source, model: { id: "model" } } }),
    civitaiVersion: async () => ({ model: "model", version: { id: "10" }, source: { component_id: source }, examples: [{ applicable: true, source: { component_id: source }, binding: { complete: true, entity_id: target, file_id: file, media: [{ kind: "image", component_id: image }] } }] }),
    memberships: async ids => ids[0] === origin ? [{ entity_id: origin, status: "present", memberships: [{ component_id: source }] }] : members(),
    savedPreview: async () => ({ kind: "image", file_id: file, locator: "preview" }), previewBytes: async () => new Blob(["preview"]),
    changeCardCoverPreference: async (id, body) => { calls.push(body); observed = { status: "saved", entity_id: id, revision: "1", cover: body.cover }; return { status: "card_cover_preference_saved", preference: observed } },
    ...overrides,
  }
  const c = new CardCoverCoordinator(api, entityProjection ?? (id => ({ id, components: [{ id: source, kind: "civitai", readStatus: "ready", record: { matched_version: "10", observation: "observation" }, view: { input: "current" } }] })))
  return { c, api, calls }
}
test("automatic saved example and explicit cover stay independent of viewer choices", async t => {
  const f = fixture(); t.after(() => f.c.dispose())
  f.c.demand([origin]); await delay(0)
  assert(f.c.get(origin).preview?.startsWith("blob:"))
  await f.c.choose(origin, selection); await delay(0)
  assert.deepEqual(f.calls[0].cover, selection)
  assert.equal(f.calls[0].expected_revision, null)
  assert.equal(f.c.get(origin).observed.revision, "1")
  await f.c.choose(origin, null)
  assert.equal(f.calls[1].expected_revision, "1")
  assert.equal(f.calls[1].cover, null)
})
test("late membership replacement rejects bytes while retaining explicit intent", async t => {
  let replaced = false
  const f = fixture({ cardCoverPreferences: async () => [{ status: "saved", entity_id: origin, revision: "1", cover: selection }],
    previewBytes: async () => { replaced = true; return new Blob(["old bytes"]) },
    memberships: async ids => ids[0] === origin ? [{ entity_id: origin, status: "present", memberships: [{ component_id: source }] }] : replaced ? [{ ...members()[0], memberships: [] }] : members(),
  })
  t.after(() => f.c.dispose()); f.c.demand([origin]); await delay(0)
  assert.equal(f.c.get(origin).preview, undefined)
  assert.match(f.c.get(origin).unavailable, /membership changed/)
  assert.deepEqual(f.c.get(origin).observed.cover, selection)
})
test("unconfirmed saves block new work and recover the original request", async t => {
  let body, writes = 0
  const f = fixture({ changeCardCoverPreference: async (_, request) => { body = request; writes++; throw new Error("lost response") },
    submission: async request => { assert.equal(request, body.request_id); return { status: "direct_complete", outcome: { status: "card_cover_preference_saved", preference: { entity_id: origin, revision: "1", cover: body.cover } } } },
  })
  t.after(() => f.c.dispose()); f.c.demand([origin]); await delay(0)
  await f.c.choose(origin, selection); await f.c.choose(origin, null)
  assert.equal(writes, 1)
  assert.match(f.c.preparation().blocked, /unconfirmed/)
  await f.c.retry(origin)
  assert.equal(f.c.get(origin).attempt, undefined)
  assert.equal(f.c.preparation().blocked, undefined)
})
test("an old batched read cannot overwrite a newer confirmed cover", async t => {
  let release
  const batch = new Promise(resolve => { release = resolve })
  const f = fixture({ cardCoverPreferences: () => batch })
  t.after(() => f.c.dispose())
  f.c.demand([origin])
  await f.c.choose(origin, selection)
  release([{ status: "unset", entity_id: origin }])
  await delay(0)
  assert.equal(f.c.get(origin).observed.status, "saved")
  assert.deepEqual(f.c.get(origin).observed.cover, selection)
})
test("observed target membership changes invalidate an already displayed cover", async t => {
  let changed = false
  const f = fixture({ memberships: async ids => ids[0] === origin ? [{ entity_id: origin, status: "present", memberships: [{ component_id: source }] }] : changed ? [{ ...members()[0], memberships: [] }] : members() }, id => id === target
    ? { id, membershipsStatus: "present", components: changed ? [] : [{ id: file, kind: "file" }, { id: image, kind: "image" }] }
    : { id, components: [{ id: source, kind: "civitai", readStatus: "ready", record: { matched_version: "10", observation: "observation" }, view: { input: "current" } }] })
  t.after(() => f.c.dispose()); f.c.demand([origin]); await delay(0)
  assert(f.c.get(origin).preview)
  changed = true; f.c.observe(); await delay(0)
  assert.equal(f.c.get(origin).preview, undefined)
  assert.match(f.c.get(origin).unavailable, /membership changed/)
})
