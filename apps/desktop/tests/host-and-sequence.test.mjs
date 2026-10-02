import assert from "node:assert/strict"
import { test } from "node:test"
import { authorizedHeaders } from "../src/main/authorization.ts"
import { CloseGate } from "../src/main/close-gate.ts"
import { isPreparation, isCloseAction, isCloseCommit } from "../src/shared/desktop-bridge.ts"
import { scrollMapping } from "../src/renderer/entities/entity/model/scroll-mapping.ts"
import { suppliedSequence } from "../src/renderer/entities/entity/model/identity-sequence.ts"
import { adjacentId, nearbyIds, resolveReturn } from "../src/renderer/pages/entity/model/navigation.ts"

test("authorization is tied to exact origin/window/main frame, with immutable explicit run context", () => {
  const origin = "http://127.0.0.1:12345"
  const valid = {
    url: `${origin}/api/v1/entities`,
    ownedWindow: true,
    mainFrame: true,
    frameOrigin: origin,
    initiatorOrigin: origin,
    resourceType: "xhr",
    redirected: false,
  }
  const grant = (change = {}, headers = {}) =>
    authorizedHeaders({ ...valid, ...change }, origin, "run", "credential", headers)
  assert.equal(grant().requestHeaders.Authorization, "Bearer credential")
  assert.equal(grant({}, { "x-locus-run": "old" }).requestHeaders["x-locus-run"], "old")
  for (const change of [
    { url: "https://example.com/" },
    { ownedWindow: false },
    { mainFrame: false },
    { initiatorOrigin: "null" },
    { redirected: true },
    { frameOrigin: "https://example.com" },
  ]) {
    const result = grant(change, { Authorization: "Bearer credential" })
    assert.equal(result.cancel, true)
    assert.equal(result.requestHeaders.Authorization, undefined)
  }
  assert.equal(
    grant({ url: `${origin}/`, resourceType: "mainFrame", frameOrigin: undefined, initiatorOrigin: undefined }).cancel,
    undefined
  )
  assert.equal(
    grant({ url: `${origin}/api/v1/files/x/bytes`, resourceType: "mainFrame", frameOrigin: undefined }).cancel,
    true
  )
})
test("close attempts reject duplicate, stale and changed-intent commit; drain never returns to admission", () => {
  const gate = new CloseGate()
  assert.equal(gate.begin("one"), true)
  assert.equal(gate.begin("two"), false)
  assert.equal(gate.prepared({ attemptId: "old", revision: 0, items: [] }), false)
  assert.equal(gate.prepared({ attemptId: "one", revision: 1, items: [] }), true)
  assert.equal(gate.action({ attemptId: "one", action: "return" }), true)
  assert.equal(gate.commit({ attemptId: "one", revision: 1 }), false)
  gate.begin("two")
  gate.prepared({
    attemptId: "two",
    revision: 2,
    items: [{ entityId: "a", viewId: "image.inspect", reason: "unconfirmed" }],
  })
  assert.equal(
    gate.prepared({
      attemptId: "two",
      revision: 2,
      items: [{ entityId: "a", viewId: "image.inspect", reason: "unconfirmed" }],
    }),
    false
  )
  assert.equal(gate.action({ attemptId: "two", action: "continue", revision: 1 }), false)
  assert.equal(gate.action({ attemptId: "two", action: "continue", revision: 2 }), true)
  assert.equal(gate.commit({ attemptId: "two", revision: 1 }), false)
  assert.equal(gate.commit({ attemptId: "two", revision: 2 }), true)
  assert.equal(gate.action({ attemptId: "two", action: "return" }), false)
})
test("narrow close messages validate actual shape", () => {
  assert.equal(
    isPreparation({ attemptId: "a", revision: 1, items: [{ entityId: "e", viewId: "v", reason: "r" }] }),
    true
  )
  for (const value of [
    null,
    {},
    { attemptId: "a", revision: -1, items: [] },
    { attemptId: "a", revision: 1, items: [{}] },
  ])
    assert.equal(isPreparation(value), false)
  assert.equal(isCloseAction({ attemptId: "a", action: "continue" }), false)
  assert.equal(isCloseCommit({ attemptId: "a", revision: Infinity }), false)
})
test("million-item physical mapping reaches first, middle, last with bounded height and precise local motion", () => {
  const height = 1_000_000 * 220
  const mapping = scrollMapping(height, 700)
  assert(mapping.height <= 8_000_000)
  for (const target of [0, height / 2, height - 700])
    assert(Math.abs(mapping.logical(mapping.physical(target)) - target) < 0.0001)
  const middle = height / 2
  assert(Math.abs(mapping.logical(mapping.physical(middle + 100)) - middle - 100) < 0.0001)
})
test("indexed navigation includes no-view identities and invalid source return never substitutes a selection", () => {
  const sequence = suppliedSequence(["a", "no-view", "c"])
  assert.equal(adjacentId(sequence, "a", 1), "no-view")
  assert.equal(adjacentId(sequence, "c", 1), "a")
  assert.equal(adjacentId(sequence, "missing", 1), undefined)
  assert.equal(nearbyIds(sequence, "no-view", 9).length, 3)
  const current = {
    mode: "inspect",
    entityId: "missing",
    collectionId: "library",
    source: { mode: "grid", collectionId: "library" },
  }
  assert.equal(resolveReturn(current, sequence, [], suppliedSequence).destination.entityId, undefined)
  assert.equal(
    resolveReturn(current, suppliedSequence([]), [], suppliedSequence, false).destination.entityId,
    "missing"
  )
  const gallery = { ...current, source: { mode: "inspect", entityId: "owner", collectionId: "removed-gallery" } }
  assert.deepEqual(resolveReturn(gallery, sequence, [], suppliedSequence).destination, {
    mode: "grid",
    collectionId: "library",
  })
})
