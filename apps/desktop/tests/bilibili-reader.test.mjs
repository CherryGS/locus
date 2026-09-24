import assert from "node:assert/strict"
import { test } from "node:test"
import { setImmediate as turn } from "node:timers/promises"
import { EntityReader } from "../src/renderer/entities/entity/model/entity-reader.ts"
import {
  bilibiliProjection,
  bilibiliProblems,
} from "../src/renderer/entities/entity/model/live-projection.ts"
import { availableViews } from "../src/renderer/pages/entity/model/content-views.ts"
import { entityCardDisplay } from "../src/renderer/entities/entity/model/entity-card-display.ts"
import { ApiFailure } from "../src/renderer/shared/api/backend-api.ts"

const kind = "8301851c-9b14-4369-a6ce-bb7058686215"
const tick = async () => {
  await turn()
  await turn()
}
const view = (snapshot) => ({
  record: { component_id: "b", kind_id: kind, revision: "1", basis: null, snapshot },
  applicability: {
    status: "input",
    host: "e",
    comparison: { status: "incomplete", basis: null, current: { status: "missing_slot", entity_id: "e" } },
    file_error: null,
  },
})

test("Bilibili retains precise part/role observations, emptiness and unknown fields", () => {
  const value = view({
    bvid: "BV145PxzCEoE",
    description: "",
    title: "Submission",
    part: { cid: "18446744073709551615", index: 2 },
    asset_role: "cover",
  })
  const projected = bilibiliProjection(value)
  assert.equal(projected.record.snapshot.part.cid, "18446744073709551615")
  assert.equal(projected.record.snapshot.description, "")
  assert.equal(projected.record.snapshot.uploader, undefined)
  const entity = { id: "e", components: [projected] }
  assert.equal(availableViews(entity)[0].id, "bilibili.read")
  assert.equal(entityCardDisplay(entity).title, "Submission · P2 · Cover")
  assert.deepEqual(bilibiliProblems(value, "e"), [])
  value.record.basis = "old"
  value.applicability.comparison = { status: "changed", basis: "old", current: "new" }
  assert.match(bilibiliProblems(value, "e")[0].message, /old.*new/)
})

test("Bilibili read failure retains prior data; reread replaces it and absence clears it", async () => {
  const api = {
    memberships: async (ids) =>
      ids.map((entity_id) => ({
        status: "present",
        entity_id,
        memberships: [{ entity_id, component_id: "b", kind_id: kind }],
      })),
    bilibili: async () => view({ bvid: "BV145PxzCEoE", title: "Previous", part: { cid: "123", index: 2 } }),
  }
  const reader = new EntityReader(api)
  reader.demand(["e"])
  await tick()
  assert.equal(reader.get("e").components[0].record.snapshot.title, "Previous")
  api.bilibili = async () => {
    throw new Error("isolated read failure")
  }
  await reader.reread("e")
  await tick()
  assert.equal(reader.get("e").components[0].previous, true)
  assert.equal(reader.get("e").components[0].record.snapshot.part.index, 2)
  api.bilibili = async () => view({ bvid: "BV145PxzCEoE", description: "" })
  await reader.reread("e")
  await tick()
  assert.equal(reader.get("e").components[0].record.snapshot.part, undefined)
  api.bilibili = async () => {
    throw new ApiFailure(
      {
        code: "operation_failed",
        message: "Missing",
        diagnostic: { owner: "bilibili", error: { code: "missing_record", component_id: "b" } },
      },
      500,
    )
  }
  await reader.reread("e")
  await tick()
  assert.equal(reader.get("e").components[0].record, undefined)
  assert.equal(availableViews(reader.get("e"))[0].id, "bilibili.read")
})
