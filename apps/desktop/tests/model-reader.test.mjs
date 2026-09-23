import assert from "node:assert/strict"
import { test } from "node:test"
import { setImmediate as turn } from "node:timers/promises"
import { EntityReader } from "../src/renderer/entities/entity/model/entity-reader.ts"
import { modelProblems } from "../src/renderer/entities/entity/model/live-projection.ts"
import { availableViews, resolveView } from "../src/renderer/pages/entity/model/content-views.ts"
const kind = "6c46d4eb-5c2f-46eb-9e81-f866884e3107"
const value = (id = "m", declarations = { name: "first" }) => ({
  host: "a",
  record: {
    component_id: id,
    revision: "1",
    basis: "f",
    last_failure: null,
    facts: {
      format: "SafeTensors",
      coverage: "header only",
      tensor_count: "1",
      element_count: "9007199254740993",
      tensors: [{ name: "tensor", shape: ["9007199254740993"], storage_type: "U8" }],
      storage_types: {
        U8: { tensor_count: "1", element_count: "9007199254740993" },
      },
      declarations,
    },
  },
  applicability: { status: "matching", file_id: "f" },
  file_problem: null,
})
const tick = async () => {
  await turn()
  await turn()
}
test("Model reading keeps coherent results on failure and drops removed optional declarations on replacement", async () => {
  let current = value(),
    error = false,
    component = "m",
    reads = 0
  const api = {
    memberships: async () => [
      {
        status: "present",
        entity_id: "a",
        memberships: [{ entity_id: "a", component_id: component, kind_id: kind }],
      },
    ],
    model: async () => {
      reads++
      if (error) throw new Error("failed Model read")
      return current
    },
  }
  const reader = new EntityReader(api)
  reader.demand(["a"])
  await tick()
  assert.equal(reader.get("a").components[0].record.facts.element_count, "9007199254740993")
  error = true
  await reader.reread("a")
  await tick()
  assert.equal(reader.get("a").components[0].previous, true)
  assert.equal(reader.get("a").components[0].record.facts.declarations.name, "first")
  error = false
  current = value("m", null)
  await reader.reread("a")
  await tick()
  assert.equal(reader.get("a").components[0].record.facts.declarations, null)
  component = "new"
  error = true
  await reader.reread("a")
  await tick()
  assert.equal(reader.get("a").components[0].record, undefined)
  assert.equal(reader.get("a").components[0].readStatus, "failed")
  assert.equal(reads, 4)
})
test("Model availability follows membership and diagnostics keep independent scopes", () => {
  const entity = {
    id: "a",
    components: [
      { kind: "file", id: "f" },
      { kind: "model", id: "m", readStatus: "failed" },
    ],
  }
  assert.equal(resolveView(entity, null), "model.read")
  assert.equal(resolveView(entity, "file.info"), "file.info")
  assert.equal(availableViews(entity).length, 2)
  const v = value()
  v.record.last_failure = { code: "worker", detail: "worker failed" }
  v.applicability = { status: "changed", basis: "old", current: "new" }
  v.file_problem = {
    owner: "file",
    diagnostic: { kind: "database", message: "record failure" },
  }
  assert.deepEqual(
    modelProblems(v, "a").map((p) => p.key),
    ["inspection", "input", "file"]
  )
  v.applicability = { status: "matching", file_id: "f" }
  assert.deepEqual(
    modelProblems(v, "a").map((p) => p.key),
    ["inspection", "file"]
  )
})
