import assert from "node:assert/strict"
import { test } from "node:test"
import { createMemoryHistory } from "@tanstack/react-router"
import {
  adjacentEntity,
  nearbyEntities,
  inspectionDestination,
  relatedDestination,
  exitDestination,
} from "../src/renderer/pages/entity/model/navigation.ts"
import { resolveView } from "../src/renderer/pages/entity/model/content-views.ts"

const image = { id: "a", components: [{ kind: "image" }, { kind: "file" }] }
const file = { id: "b", components: [{ kind: "file" }] }
const empty = { id: "c", components: [] }
const list = [image, file, empty]
test("full sequence wraps through File and no-view entries without single-item visits", () => {
  assert.equal(adjacentEntity(list, "a", 1), file)
  assert.equal(adjacentEntity(list, "b", 1), empty)
  assert.equal(adjacentEntity(list, "c", 1), image)
  assert.equal(adjacentEntity(list, "a", -1), empty)
  assert.equal(adjacentEntity([empty], "c", 1), undefined)
  assert.equal(adjacentEntity([], "a", 1), undefined)
  assert.deepEqual(
    nearbyEntities(list, "b", 9).map(({ entity, offset }) => [entity.id, offset]),
    [
      ["a", -1],
      ["b", 0],
      ["c", 1],
    ]
  )
  const many = Array.from({ length: 1000 }, (_, i) => ({ id: String(i) }))
  assert.equal(nearbyEntities(many, "900", 5).length, 5)
})
test("views resolve the supplied choice without skipping empty Entities", () => {
  assert.equal(resolveView(image, null), "image.inspect")
  assert.equal(resolveView(image, "file.info"), "file.info")
  assert.equal(resolveView(file, "image.inspect"), "file.info")
  assert.equal(resolveView(empty, "image.inspect"), null)
})

test("Video remains a content choice without a playable source and follows the full Entity sequence", () => {
  const video = { id: "v", components: [{ kind: "file" }, { kind: "video" }] }
  assert.equal(resolveView(video, null), "video.play")
  assert.equal(resolveView(video, "file.info"), "file.info")
  assert.equal(resolveView(video, "image.inspect"), "video.play")
  assert.equal(resolveView(image, "video.play"), "image.inspect")
  assert.equal(adjacentEntity([image, video, file, empty], "a", 1), video)
  assert.equal(adjacentEntity([image, video, file, empty], "v", 1), file)
})
test("router history records M P Q separately while Esc addresses its declared source", () => {
  const history = createMemoryHistory({ initialEntries: ["/entity"] })
  const grid = { entityId: "M", mode: "grid", collectionId: "library" }
  history.replace("/entity", { destination: grid })
  const m = inspectionDestination(grid, "M")
  history.push("/entity?entityId=M", { destination: m })
  const gallery = { id: "gallery", ownerId: "M", viewId: "file.info" }
  const p = relatedDestination(m, gallery, "P")
  history.push("/entity?entityId=P", { destination: p })
  const q = inspectionDestination(p, "Q")
  history.push("/entity?entityId=Q", { destination: q })
  history.back()
  assert.equal(history.location.state.destination.entityId, "P")
  history.back()
  assert.equal(history.location.state.destination.entityId, "M")
  history.forward()
  history.forward()
  assert.equal(history.location.state.destination.entityId, "Q")
  const exit = exitDestination(q)
  assert.equal(exit.entityId, "M")
  assert.equal(exit.viewId, "file.info")
  history.push("/entity?entityId=M", { destination: exit })
  history.back()
  assert.equal(history.location.state.destination.entityId, "Q")
  assert.equal(exitDestination(inspectionDestination(m, "far-away")).entityId, "far-away")
})
