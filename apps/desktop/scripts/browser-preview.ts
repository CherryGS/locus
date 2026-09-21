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
          `const state={connection:{status:"ready",origin:location.origin,runId:${JSON.stringify(backend.context.runId)}},close:{phase:"idle"}};const listeners=new Set();window.locusDesktop=Object.freeze({state:async()=>state,ready:async()=>{},observe:f=>{listeners.add(f);return()=>listeners.delete(f)},prepared:async()=>{},closeAction:async()=>{},commitClose:async()=>{}});`
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
      const body = request.method === "GET" || request.method === "HEAD" ? undefined : await bytes(request)
      const upstream = await backend.authorizedFetch(`${backend.context.origin}${target.pathname}${target.search}`, {
        method: request.method,
        headers,
        body,
      })
      const outputHeaders = Object.fromEntries(upstream.headers)
      delete outputHeaders["transfer-encoding"]
      delete outputHeaders["content-length"]
      const content = Buffer.from(await upstream.arrayBuffer())
      const output =
        (target.pathname === "/" || target.pathname === "/index.html") && upstream.ok
          ? Buffer.from(content.toString().replace("<head>", '<head><script src="/__desktop-preview.js"></script>'))
          : content
      outputHeaders["content-length"] = String(output.length)
      response.writeHead(upstream.status, outputHeaders)
      response.end(output)
    } catch {
      if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" })
      response.end("Isolated backend unavailable")
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
