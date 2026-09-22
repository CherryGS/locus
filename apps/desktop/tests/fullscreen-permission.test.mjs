import assert from "node:assert/strict"
import { test } from "node:test"
import { rendererPermission } from "../src/main/authorization.ts"

test("explicit fullscreen belongs only to the owned current main renderer page", () => {
  const origin = "http://127.0.0.1:42100"
  assert(rendererPermission("fullscreen", true, true, `${origin}/#/entity`, origin))
  for (const [permission, owned, mainFrame, url, current] of [
    ["fullscreen", false, true, `${origin}/`, origin],
    ["fullscreen", true, false, `${origin}/`, origin],
    ["fullscreen", true, true, `${origin}/api/v1/files/id/bytes`, origin],
    ["fullscreen", true, true, "https://example.org/", origin],
    ["fullscreen", true, true, `${origin}/`, undefined],
    ["automatic-fullscreen", true, true, `${origin}/`, origin],
    ["media", true, true, `${origin}/`, origin],
  ])
    assert.equal(rendererPermission(permission, owned, mainFrame, url, current), false)
})
