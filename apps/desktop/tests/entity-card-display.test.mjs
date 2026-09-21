import assert from "node:assert/strict"
import { test } from "node:test"
import { fileDisplayItems, imageDisplayItems } from "../src/renderer/entities/entity/model/component-display-items.ts"
import { resolveDisplaySlot } from "../src/renderer/entities/entity/model/display-slot.ts"
import { entityCardDisplay } from "../src/renderer/entities/entity/model/entity-card-display.ts"

const file = Object.freeze({
  kind: "file", id: "file-original", originalName: "original.png", bytes: 2048,
  importedAt: "2026-09-20T02:00:00.000Z",
})
const image = Object.freeze({
  kind: "image", id: "image-retained", format: "PNG", width: 1200, height: 800,
  thumbnail: "preview-resource", colorMode: "RGB", bitsPerChannel: 8, hasAlphaChannel: false,
})
const entity = Object.freeze({
  id: "entity-identity", name: "Separate overview label", components: Object.freeze([file, image]),
})

test("each card slot selects its own contribution, independently of attachment order", () => {
  const expected = { title: "original.png", preview: { src: "preview-resource" }, summary: "1200 × 800" }
  assert.deepEqual(entityCardDisplay(entity), expected)
  assert.deepEqual(entityCardDisplay({ ...entity, components: [image, file] }), expected)
  assert.equal(entity.name, "Separate overview label")
})

test("field-level ordering can change one slot without ranking the whole component", () => {
  assert.equal(resolveDisplaySlot(entity, [fileDisplayItems.size, imageDisplayItems.dimensions]), "2 KiB")
  assert.equal(resolveDisplaySlot(entity, [imageDisplayItems.dimensions, fileDisplayItems.size]), "1200 × 800")
  assert.equal(resolveDisplaySlot(entity, [fileDisplayItems.originalName]), "original.png")
})

test("missing components leave other slots usable and all misses return no content", () => {
  assert.deepEqual(entityCardDisplay({ ...entity, components: [image] }), {
    title: undefined, preview: { src: "preview-resource" }, summary: "1200 × 800",
  })
  assert.deepEqual(entityCardDisplay({ ...entity, components: [] }), {
    title: undefined, preview: undefined, summary: undefined,
  })
  assert.equal(resolveDisplaySlot(entity, []), undefined)
})

test("zero-valued content is present and a winner stops further candidate evaluation", () => {
  const fail = () => assert.fail("A lower-priority candidate should not run after a value is selected")
  assert.equal(resolveDisplaySlot(entity, [() => undefined, () => 0, fail]), 0)
  assert.equal(resolveDisplaySlot(entity, [() => false, fail]), false)
  assert.equal(entityCardDisplay({ ...entity, components: [{ ...file, bytes: 0 }] }).summary, "0 bytes")
})

test("selection reflects supplied data changes without retaining a previous winner", () => {
  const fileOnly = { ...entity, components: [file] }
  assert.equal(entityCardDisplay(entity).summary, "1200 × 800")
  assert.deepEqual(entityCardDisplay(fileOnly), { title: "original.png", preview: undefined, summary: "2 KiB" })
  assert.equal(entityCardDisplay(entity).summary, "1200 × 800")
})

test("retained dimensions remain usable after a File change without rewriting the input", () => {
  const changed = {
    ...entity,
    components: [
      { ...file, id: "file-replacement", originalName: "replacement.bin", bytes: 4096 },
      { ...image, thumbnail: undefined },
    ],
  }
  const before = structuredClone(changed)
  assert.deepEqual(entityCardDisplay(changed), {
    title: "replacement.bin", preview: undefined, summary: "1200 × 800",
  })
  assert.deepEqual(changed, before)
  assert.equal(changed.id, entity.id)
})

test("Video contributes a static poster and duration while missing facts keep other slots usable", () => {
  const video = { kind: "video", id: "video", thumbnail: "video-poster", durationSeconds: 3605 }
  const components = [file, video]
  assert.deepEqual(entityCardDisplay({ ...entity, components }), {
    title: "original.png", preview: { src: "video-poster" }, summary: "1:00:05",
  })
  assert.equal(entityCardDisplay({ ...entity, components: [video, image, file] }).summary, "1200 × 800")
  assert.equal(entityCardDisplay({ ...entity, components: [file, { ...video, durationSeconds: 0 }] }).summary, "0:00")
  assert.deepEqual(entityCardDisplay({ ...entity, components: [file, { kind: "video", id: "video" }] }), {
    title: "original.png", preview: undefined, summary: "2 KiB",
  })
})
