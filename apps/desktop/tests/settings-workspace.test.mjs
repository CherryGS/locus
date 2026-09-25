import assert from "node:assert/strict"
import { test } from "node:test"
import { restoreGridPosition } from "../src/renderer/pages/entity/model/browsing-state.ts"

test("grid restoration follows identity through changed order and columns without choosing a replacement", () => {
  const ids = ["a", "b", "c", "d", "e", "f"]
  const sequence = { length: ids.length, at: (index) => ids[index], indexOf: (id) => ids.indexOf(id) }
  const position = { anchor: "e", offset: 17, logical: 417 }
  assert.equal(restoreGridPosition(position, sequence, 2, 100), 217)
  assert.equal(restoreGridPosition(position, sequence, 3, 100), 117)
  ids.unshift("new")
  assert.equal(restoreGridPosition(position, sequence, 2, 100), 217)
  ids.splice(ids.indexOf("e"), 1)
  assert.equal(restoreGridPosition(position, sequence, 2, 100), 417)
  assert.equal(position.anchor, "e")
})
