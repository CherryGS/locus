import assert from "node:assert/strict"
import { test } from "node:test"
import { browserPreview } from "../scripts/browser-preview.ts"

test("browser verification preserves media ranges, HEAD length and incomplete transfers", async () => {
  const preview = await browserPreview({
    context: { origin: "http://127.0.0.1:12345", runId: "verification" },
    authorizedFetch: async (input, init) => {
      const request = new Request(input, init)
      assert.equal(request.headers.get("accept-encoding"), "identity")
      const headers = { "content-type": "application/octet-stream", "accept-ranges": "bytes" }
      if (request.method === "HEAD")
        return new Response(null, { headers: { ...headers, "content-length": "10" } })
      if (new URL(request.url).pathname === "/truncated") {
        let emitted = false
        return new Response(new ReadableStream({
          pull(controller) {
            if (!emitted) {
              emitted = true
              controller.enqueue(new TextEncoder().encode("012"))
            } else controller.error(new Error("input ended early"))
          },
        }), { headers: { ...headers, "content-length": "10" } })
      }
      assert.equal(request.headers.get("range"), "bytes=2-4")
      return new Response("234", {
        status: 206,
        headers: { ...headers, "content-range": "bytes 2-4/10", "content-length": "3" },
      })
    },
  })
  try {
    const head = await fetch(`${preview.origin}/bytes`, { method: "HEAD" })
    assert.equal(head.headers.get("content-length"), "10")
    assert.equal(await head.text(), "")
    const range = await fetch(`${preview.origin}/bytes`, { headers: { Range: "bytes=2-4" } })
    assert.equal(range.status, 206)
    assert.equal(range.headers.get("content-range"), "bytes 2-4/10")
    assert.equal(range.headers.get("content-length"), "3")
    assert.equal(await range.text(), "234")
    await assert.rejects(async () => {
      const truncated = await fetch(`${preview.origin}/truncated`)
      await truncated.arrayBuffer()
    })
  } finally {
    await preview.close()
  }
})
