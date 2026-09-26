import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { fixturePng } from "../../../packages/locus-client/smoke-png.ts"
import { startServer, workspace } from "./fixture.ts"
import { browserPreview } from "./browser-preview.ts"

// Deliberately ignore LOCUS_DATA_DIR: review tasks must not enter a user's library.
const root = join(workspace, "target", "task-panel-sample")
const library = join(root, "library")
await mkdir(root, { recursive: true })
const photo = join(root, "landscape.png")
const notes = join(root, "reference-notes.txt")
await writeFile(photo, fixturePng(960, 540))
await writeFile(notes, "Task panel review: retained sample library.\n")
const backend = await startServer(library)
let preview: Awaited<ReturnType<typeof browserPreview>> | undefined
let closing = false
async function stop() {
  if (closing) return
  closing = true
  await preview?.close()
  await backend.stop()
}
async function terminal(id: string) {
  const signal = AbortSignal.timeout(30_000)
  for (;;) {
    const result = await backend.client.GET("/api/v1/tasks/{task_id}/outcome", {
      params: { path: { task_id: id } },
      signal,
    })
    assert(result.data)
    if (result.data.status === "complete") return
    await delay(25, undefined, { signal })
  }
}
process.once("SIGINT", () => void stop())
process.once("SIGTERM", () => void stop())
try {
  for (const paths of [[photo, join(root, "missing-source", randomUUID(), "portrait.png")], [notes]]) {
    const result = await backend.client.POST("/api/v1/import-batches", {
      body: { request_id: randomUUID(), source_paths: paths },
    })
    assert(result.data)
    await terminal(result.data.task_id)
  }
  const file = await backend.client.POST("/api/v1/imports", {
    body: { request_id: randomUUID(), source_path: notes },
  })
  assert(file.data)
  await terminal(file.data.task_id)
  preview = await browserPreview(backend)
  const info = {
    preview: `${preview.origin}/#/entity`,
    library,
    mode: "isolated task review; records regenerated each run",
  }
  await writeFile(join(root, "connection.json"), JSON.stringify(info, null, 2))
  console.log(JSON.stringify(info))
} catch (error) {
  await stop()
  throw error
}
