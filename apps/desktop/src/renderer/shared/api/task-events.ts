import type { Wire } from "./backend-api"

/** SSE framing is incremental across UTF-8 bytes and all legal line endings. */
export async function readTaskEvents(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  receive: (value: Wire<"TaskSnapshot">) => void,
) {
  const reader = stream.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true })
  let buffer = "",
    event = "",
    data: string[] = [],
    skipLf = false
  function line(value: string) {
    if (!value) {
      if (event === "snapshot" && data.length) receive(JSON.parse(data.join("\n")) as Wire<"TaskSnapshot">)
      event = ""
      data = []
    } else {
      const colon = value.indexOf(":"),
        field = colon < 0 ? value : value.slice(0, colon)
      const content = colon < 0 ? "" : value.slice(colon + 1).replace(/^ /, "")
      if (field === "event") event = content
      if (field === "data") data.push(content)
    }
  }
  const abort = () => {
    void reader.cancel()
  }
  signal.addEventListener("abort", abort, { once: true })
  try {
    while (!signal.aborted) {
      const chunk = await reader.read()
      if (chunk.done) {
        if (!signal.aborted) throw new Error("Task observation disconnected")
        break
      }
      for (const char of decoder.decode(chunk.value, { stream: true })) {
        if (skipLf && char === "\n") {
          skipLf = false
          continue
        }
        skipLf = char === "\r"
        if (char === "\r" || char === "\n") {
          line(buffer)
          buffer = ""
        } else buffer += char
      }
    }
  } finally {
    signal.removeEventListener("abort", abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
