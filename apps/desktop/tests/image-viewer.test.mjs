import assert from "node:assert/strict"
import { test } from "node:test"
import { fitImageScale, zoomImage } from "../src/renderer/pages/entity/model/image-transform.ts"

test("fit preserves aspect ratio and does not upscale small representations", () => {
  assert.equal(fitImageScale({ width: 1200, height: 800 }, { width: 600, height: 600 }), 0.5)
  assert.equal(fitImageScale({ width: 800, height: 1200 }, { width: 600, height: 600 }), 0.5)
  assert.equal(fitImageScale({ width: 80, height: 60 }, { width: 600, height: 600 }), 1)
})

test("fit follows a resized viewing area instead of retained viewport dimensions", () => {
  const image = { width: 1200, height: 800 }
  assert.equal(fitImageScale(image, { width: 900, height: 800 }), 0.75)
  assert.equal(fitImageScale(image, { width: 300, height: 800 }), 0.25)
})

test("cursor-centered zoom keeps the same image point stationary", () => {
  const view = { scale: 0.5, x: 20, y: -30 }
  const point = { x: 120, y: 70 }
  const next = zoomImage(view, 2, point)
  assert.deepEqual(next, { scale: 1, x: -80, y: -130 })
  assert.equal((point.x - view.x) / view.scale, (point.x - next.x) / next.scale)
  assert.equal((point.y - view.y) / view.scale, (point.y - next.y) / next.scale)
  assert.deepEqual(zoomImage(next, 0.5, point), view)
})

test("zoom rejects non-renderable arithmetic without imposing a product zoom cap", () => {
  const view = { scale: 1, x: 0, y: 0 }
  assert.equal(zoomImage(view, 0), view)
  assert.equal(zoomImage(view, Infinity), view)
  assert.equal(zoomImage(view, 2048).scale, 2048)
})
