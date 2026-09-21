import assert from "node:assert/strict"
import { spawn, execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { setTimeout as delay } from "node:timers/promises"
import { createLocusClient, type LocusClient, type TaskOutcome } from "@locus/client"
import { fixturePng } from "../../../packages/locus-client/smoke-png.ts"

export const workspace = fileURLToPath(new URL("../../../", import.meta.url))
export const desktop = join(workspace, "apps/desktop")
export const binary =
  process.env.LOCUS_SERVER_BINARY ??
  join(workspace, "target/debug", process.platform === "win32" ? "locus-server.exe" : "locus-server")
export async function startServer(library: string, renderer = join(desktop, "out/renderer")) {
  assert(resolve(library) === library, "Verification requires an explicit absolute library")
  const credential = randomBytes(32).toString("hex")
  const child = spawn(binary, [], { stdio: "pipe", windowsHide: true })
  const exited = once(child, "exit")
  child.stderr.resume()
  const lines = createInterface({ input: child.stdout })
  const ready = once(lines, "line", { signal: AbortSignal.timeout(30_000) })
  child.stdin.end(JSON.stringify({ credential, library_root: library, renderer_root: renderer }))
  const [line] = await Promise.race([
    ready,
    exited.then(() => {
      throw new Error("Fixture backend exited before readiness")
    }),
  ])
  lines.close()
  const value = JSON.parse(String(line)) as { origin: string; run_id: string }
  const context = { origin: value.origin, runId: value.run_id }
  const authorizedFetch: typeof fetch = (input, init) => {
    const request = new Request(input, init)
    assert.equal(new URL(request.url).origin, context.origin)
    request.headers.set("Authorization", `Bearer ${credential}`)
    request.headers.set("X-Locus-Run", request.headers.get("X-Locus-Run") ?? context.runId)
    return fetch(new Request(request, { redirect: "error" }))
  }
  const client = createLocusClient(context, authorizedFetch)
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    await client.POST("/api/v1/drain")
    await exited
  }
  return { context, child, exited, client, authorizedFetch, stop }
}
async function complete(client: LocusClient, taskId: string): Promise<TaskOutcome> {
  const deadline = AbortSignal.timeout(30_000)
  for (;;) {
    const result = await client.GET("/api/v1/tasks/{task_id}/outcome", {
      params: { path: { task_id: taskId } },
      signal: deadline,
    })
    assert(result.data, JSON.stringify(result.error))
    if (result.data.status === "complete") return result.data.outcome
    await delay(5, undefined, { signal: deadline })
  }
}
export async function fixture(count?: number) {
  const root = await mkdtemp(join(tmpdir(), count ? "locus-entity-scale-" : "locus-desktop-"))
  const library = join(root, "library")
  const images: { entityId: string; fileId: string; componentId: string; width: number; height: number }[] = []
  let server = await startServer(library)
  let emptyId = ""
  let setup: { entityCount: number; totalDatabaseRows?: number } = { entityCount: 0 }
  if (count) {
    await server.stop()
    const result = await promisify(execFile)(
      "uv",
      [
        "run",
        "python",
        join(workspace, "scripts/seed-entity-scale.py"),
        join(library, "metadata.sqlite"),
        String(count),
      ],
      { cwd: workspace, windowsHide: true, timeout: 180_000 }
    )
    setup = JSON.parse(result.stdout)
  } else {
    const create = async () => {
      const result = await server.client.POST("/api/v1/entities", { body: { request_id: randomUUID() } })
      assert(result.data?.status === "entity_created")
      return result.data.entity_id
    }
    for (const [width, height] of [
      [960, 540],
      [120, 80],
      [480, 640],
    ]) {
      const entityId = await create()
      const path = join(root, `synthetic-${width}.png`)
      await writeFile(path, fixturePng(width, height))
      const imported = await server.client.POST("/api/v1/imports", {
        body: { request_id: randomUUID(), source_path: path },
      })
      assert(imported.data)
      const outcome = await complete(server.client, imported.data.task_id)
      assert(outcome.status === "imported")
      const media = await server.client.POST("/api/v1/media", { body: { request_id: randomUUID(), kind: "image" } })
      assert(media.data?.status === "media_created")
      const file = outcome.file,
        target = media.data.target
      for (const membership of [
        { entity_id: entityId, kind_id: file.kind_id, component_id: file.file_id },
        { entity_id: entityId, kind_id: media.data.kind_id, component_id: target.component_id },
      ]) {
        assert.equal(
          (await server.client.POST("/api/v1/memberships/attach", { body: { request_id: randomUUID(), membership } }))
            .data?.status,
          "attached"
        )
      }
      const interpreted = await server.client.POST("/api/v1/interpretations", {
        body: { request_id: randomUUID(), target },
      })
      assert(interpreted.data)
      const interpretation = await complete(server.client, interpreted.data.task_id)
      assert.equal(interpretation.status, "interpreted")
      images.push({ entityId, fileId: file.file_id, componentId: target.component_id, width, height })
    }
    emptyId = await create()
    setup.entityCount = images.length + 1
    await server.stop()
  }
  const start = async () => {
    server = await startServer(library)
    return server
  }
  const dispose = async () => {
    await server.stop()
    const target = resolve(root)
    if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error("Fixture cleanup escaped its temporary root")
    await rm(target, { recursive: true, force: true })
  }
  return { root, library, images, emptyId, setup, start, dispose }
}
export async function outputDirectory(label: string) {
  const directory = resolve(
    process.env.LOCUS_VERIFY_OUTPUT ?? join(workspace, "target", `desktop-${label}-${Date.now()}`)
  )
  await mkdir(directory, { recursive: true })
  return directory
}
