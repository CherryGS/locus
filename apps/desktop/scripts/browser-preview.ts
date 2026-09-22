import { createServer, type IncomingMessage } from "node:http"
import { once } from "node:events"
import { fixture, type startServer } from "./fixture.ts"

/** Isolated verification adapter only. The production Electron entry never loads
 * this proxy and credentials remain in its Node transport, outside browser JS. */
export async function browserPreview(backend: Awaited<ReturnType<typeof startServer>>) {
  let origin = ""
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.origin && request.headers.origin !== origin) {
        response.writeHead(403).end()
        return
      }
      if (request.headers.host !== new URL(origin).host) {
        response.writeHead(403).end()
        return
      }
      const target = new URL(request.url ?? "/", origin)
      if (target.origin !== origin) {
        response.writeHead(403).end()
        return
      }
      if (target.pathname === "/__desktop-preview.js") {
        response.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" })
        response.end(
          `const state={connection:{status:"ready",origin:location.origin,runId:${JSON.stringify(backend.context.runId)},availability:${JSON.stringify(backend.availability)}},close:{phase:"idle"}};const listeners=new Set();window.locusDesktop=Object.freeze({requestLifecycle:async()=>{throw new Error("Native application restart and exit are unavailable in this browser preview.")},openExternalLink:async(url)=>({url,status:"failed",message:"System-browser handoff is unavailable in this browser preview."}),selectImportFiles:async()=>({status:"canceled"}),state:async()=>state,ready:async()=>{},observe:f=>{listeners.add(f);return()=>listeners.delete(f)},prepared:async()=>{},closeAction:async()=>{},commitClose:async()=>{}});`
        )
        return
      }
      const headers = new Headers()
      for (const [key, value] of Object.entries(request.headers))
        if (
          value &&
          !["host", "connection", "content-length", "authorization", "origin", "accept-encoding"].includes(key)
        )
          headers.set(key, Array.isArray(value) ? value.join(",") : value)
      headers.set("Origin", backend.context.origin)
      headers.set("Accept-Encoding", "identity")
      const body = request.method === "GET" || request.method === "HEAD" ? undefined : await bytes(request)
      const controller = new AbortController()
      response.once("close", () => controller.abort())
      const upstream = await backend.authorizedFetch(`${backend.context.origin}${target.pathname}${target.search}`, {
        method: request.method,
        headers,
        body,
        signal: controller.signal,
      })
      const outputHeaders = Object.fromEntries(upstream.headers)
      delete outputHeaders["transfer-encoding"]
      // HEAD reports the representation length, not the empty response body.
      if (request.method === "HEAD") {
        response.writeHead(upstream.status, outputHeaders).end()
        return
      }
      if ((target.pathname === "/" || target.pathname === "/index.html") && upstream.ok) {
        const content = await upstream.text()
        const output = Buffer.from(content.replace("<head>", '<head><script src="/__desktop-preview.js"></script>'))
        outputHeaders["content-length"] = String(output.length)
        response.writeHead(upstream.status, outputHeaders).end(output)
        return
      }
      // Preserve partial-response headers and backpressure for media as well as
      // SSE; the verification proxy must not eagerly buffer an entire video.
      response.writeHead(upstream.status, outputHeaders)
      response.flushHeaders()
      if (!upstream.body) {
        response.end()
        return
      }
      const reader = upstream.body.getReader()
      try {
        while (!controller.signal.aborted) {
          const chunk = await reader.read()
          if (chunk.done) break
          if (!response.write(Buffer.from(chunk.value))) await once(response, "drain", { signal: controller.signal })
        }
        response.end()
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
    } catch {
      if (response.headersSent) response.destroy()
      else response.writeHead(502, { "content-type": "text/plain" }).end("Isolated backend unavailable")
    }
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Preview address unavailable")
  origin = `http://127.0.0.1:${address.port}`
  return {
    origin,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((done) => server.close(() => done()))
    },
  }
}
async function bytes(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

if (
  process.argv[1] &&
  new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll("\\", "/").split("/").pop()!)
) {
  const data = await fixture()
  const backend = await data.start()
  const preview = await browserPreview(backend)
  console.log(
    JSON.stringify(
      {
        preview: `${preview.origin}/#/entity`,
        library: data.library,
        fixture: data.setup,
        mode: "isolated live preview; no native close seam",
      },
      null,
      2
    )
  )
  let closing = false
  const finish = async () => {
    if (closing) return
    closing = true
    await preview.close()
    await data.dispose()
    process.exit(0)
  }
  process.once("SIGINT", () => void finish())
  process.once("SIGTERM", () => void finish())
}
