import assert from "node:assert/strict"
import { test } from "node:test"
import { entityTagObservation, tagPairBusy, latestAssignmentAttempts } from "../src/renderer/features/tags/model/entity-tag-observation.ts"

test("Tag observation separates an absent set, pending read, missing Entity and retained failed read", () => {
  const entity = { id: "subject", components: [], membershipsStatus: "present" }
  assert.deepEqual(entityTagObservation(entity), { set: undefined, tags: [], waiting: false, failed: false })
  assert.equal(entityTagObservation({ ...entity, membershipsStatus: "unread" }).waiting, true)
  assert.equal(entityTagObservation({ ...entity, membershipsStatus: "missing" }).failed, true)
  assert.equal(entityTagObservation({ ...entity, components: [{ kind: "tag", id: "set" }] }).waiting, true)
  const set = { kind: "tag", id: "set", readStatus: "failed", record: { tags: [{ id: "old", name: "Previous" }] } }
  const observation = entityTagObservation({ ...entity, components: [set] })
  assert.equal(observation.failed, true)
  assert.equal(observation.tags, set.record.tags)
  assert.equal(entityTagObservation({ ...entity, components: [{ ...set, readStatus: "loading" }] }).waiting, true)
})

test("Tag pending pairs and latest failures remain attributed when another assignment succeeds", () => {
  const attempt = (entity, tag, state) => ({ change: { operation: "add", entity_id: entity, tag_id: tag }, state })
  const a = attempt("subject", "a", "failed")
  const b = attempt("subject", "b", "confirmed")
  const other = attempt("other", "a", "pending")
  const unknown = attempt("subject", "c", "unconfirmed")
  const attempts = [a, b, other, unknown]
  assert.equal(tagPairBusy(attempts, "subject", "a"), false)
  assert.equal(tagPairBusy(attempts, "subject", "c"), true)
  assert.equal(tagPairBusy(attempts, "other", "a"), true)
  assert(latestAssignmentAttempts(attempts).includes(a))
  const recovered = attempt("subject", "a", "confirmed")
  assert(!latestAssignmentAttempts([...attempts, recovered]).includes(a))
  assert(latestAssignmentAttempts([...attempts, recovered]).includes(b))
})
