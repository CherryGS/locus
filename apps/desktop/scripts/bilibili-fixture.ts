import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, readFile, rm, rename } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { createLocusClient, uploadFile, type components } from "@locus/client"
import { fixturePng } from "../../../packages/locus-client/smoke-png.ts"
import { startServer } from "./fixture.ts"
type Wire<N extends keyof components["schemas"]> = components["schemas"][N]
export async function bilibiliFixture() {
  const root = await mkdtemp(join(tmpdir(), "locus-bilibili-check-")),
    library = join(root, "library")
  const video = join(root, "generated-video.mp4")
  await promisify(execFile)(
    process.env.LOCUS_FFMPEG ?? "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=480x270:rate=12",
      "-t",
      "3",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      video,
    ],
    { windowsHide: true, timeout: 30000 },
  )
  let server = await startServer(library, undefined, undefined, true)
  const runtime = (await server.client.GET("/api/v1/external-access/runtime")).data
  assert(runtime?.active_address)
  const token = (await server.client.GET("/api/v1/external-access/token")).data
  assert(token?.status === "current")
  const context = { origin: "http://" + runtime.active_address, runId: server.context.runId }
  const transport: typeof fetch = (input, init) => {
    const request = new Request(input, init)
    assert.equal(new URL(request.url).origin, context.origin)
    request.headers.set("Authorization", "Bearer " + token.token)
    return fetch(new Request(request, { redirect: "error" }))
  }
  const external = createLocusClient(context, transport)
  async function receipt(request_id: string) {
    for (let n = 0; n < 1000; n++) {
      const result = (
        await external.GET("/external/v1/requests/{request_id}", { params: { path: { request_id } } })
      ).data
      if (result?.status === "accepted") return result.receipt
      assert(result?.status !== "rejected", JSON.stringify(result))
      await delay(10)
    }
    throw new Error("Bilibili fixture admission timed out")
  }
  async function end(task_id: string) {
    for (let n = 0; n < 1000; n++) {
      const result = (
        await external.GET("/external/v1/tasks/{task_id}/outcome", { params: { path: { task_id } } })
      ).data
      if (result?.status === "complete") return result.outcome
      await delay(10)
    }
    throw new Error("Bilibili fixture task timed out")
  }
  async function upload(bytes: Uint8Array, name: string) {
    const request_id = randomUUID()
    await uploadFile(
      context,
      { request_id, byte_count: String(bytes.byteLength), filename: name },
      new Uint8Array(bytes),
      transport,
    )
    const outcome = await end((await receipt(request_id)).task_id)
    assert(outcome.status === "upload" && outcome.result.confirmed_file_id)
    return outcome.result.confirmed_file_id
  }
  const videoBytes = await readFile(video),
    coverBytes = fixturePng(800, 450)
  const entries: {
    name: string
    entityId: string
    componentId: string
    mainFile?: string
    coverEntity?: string
    coverFile?: string
    videoId?: string
    batchId: string
    item: Wire<"ImportItem">
  }[] = []
  async function submit(name: string, main: string | null, cover: string | null) {
    const request_id = randomUUID()
    const snapshot: Wire<"BilibiliSnapshot"> =
      name === "locator-only"
        ? { bvid: "BV1xx411c7mD" }
        : {
            bvid: "BV1xx411c7mD",
            title:
              name === "source-only" ? "A retained submission before video admission" : "Bilibili · " + name,
            description:
              "Locally generated demonstration. Each video's original cover is independently managed.",
            author: { user_id: "123", display_name: "Captured creator" },
            part: { cid: "456", number: 2, title: "Selected second part", claims: { duration_ms: "3000" } },
            published_at_unix_ms: "1750000000000",
            observed_at_unix_ms: "1750000300000",
            tags: [],
            representation: {
              url: "https://example.invalid/selected-video.mp4",
              claims: {
                width: 480,
                height: 270,
                duration_ms: "3000",
                mime_type: "video/mp4",
                quality: "Captured 480p",
              },
            },
            preview: {
              url: "https://example.invalid/remote-cover.png",
              description: "Descriptive remote preview",
            },
          }
    const response = await external.POST("/external/v1/import-batches", {
      body: {
        request_id,
        items: [
          ...(name === "partial-source" ? [{ file_id: main }] : []),
          { file_id: main, bilibili: snapshot, cover_file_id: cover },
        ],
      },
    })
    assert(response.data, JSON.stringify(response.error))
    await end((await receipt(request_id)).task_id)
    const batch = (await external.GET("/external/v1/import-batches")).data!.batches.find(
      (b) => b.original_request_id === request_id,
    )!
    const item = batch.items.at(-1)!,
      result = item.current
    assert(result.confirmed_entity_id && result.bilibili?.component_id, JSON.stringify(result))
    entries.push({
      name,
      entityId: result.confirmed_entity_id,
      componentId: result.bilibili.component_id,
      mainFile: main ?? undefined,
      coverEntity: result.bilibili.cover?.confirmed_entity_id ?? undefined,
      coverFile: cover ?? undefined,
      videoId: result.kinds.find((k) => k.kind === "video")?.component_id ?? undefined,
      batchId: batch.batch_id,
      item,
    })
    return entries.at(-1)!
  }
  for (const name of ["complete", "changed-cover", "missing-cover", "failed-cover"]) {
    const main = await upload(videoBytes, name + ".mp4")
    const cover = await upload(
      name === "failed-cover" ? new TextEncoder().encode("Not an image") : coverBytes,
      name + ".png",
    )
    const entry = await submit(name, main, cover)
    if (name === "complete") assert(entry.item.current.complete, JSON.stringify(entry.item))
    if (name === "failed-cover") assert(!entry.item.current.complete)
    if (name === "changed-cover" || name === "missing-cover") {
      const membership = {
        entity_id: entry.coverEntity!,
        kind_id: "9fd73d3d-d35d-41bc-8b73-402e12f5c017",
        component_id: cover,
      }
      assert.equal(
        (
          await server.client.POST("/api/v1/memberships/detach", {
            body: { request_id: randomUUID(), membership },
          })
        ).data?.status,
        "detached",
      )
      if (name === "changed-cover") {
        const replacement = await upload(fixturePng(200, 100), "replacement.png")
        assert.equal(
          (
            await server.client.POST("/api/v1/memberships/attach", {
              body: { request_id: randomUUID(), membership: { ...membership, component_id: replacement } },
            })
          ).data?.status,
          "attached",
        )
      }
    }
  }
  await submit("source-only", null, await upload(coverBytes, "source-only.png"))
  await submit("locator-only", null, null)
  await submit(
    "partial-source",
    await upload(videoBytes, "contended-video.mp4"),
    await upload(coverBytes, "partial-source.png"),
  )
  const recoverableFile = await upload(coverBytes, "recoverable.png")
  const metadata = (
    await server.client.GET("/api/v1/files/{file_id}", { params: { path: { file_id: recoverableFile } } })
  ).data!
  const managed = join(library, metadata.relative_path),
    held = join(root, "held-cover.png")
  await rename(managed, held)
  const recoverable = await submit(
    "recoverable-cover",
    await upload(videoBytes, "recoverable-video.mp4"),
    recoverableFile,
  )
  await rename(held, managed)
  assert(!recoverable.item.current.complete)
  const recover = async () => {
    const request_id = randomUUID()
    const result = await external.POST("/external/v1/import-recoveries", {
      body: { request_id, batch_id: recoverable.batchId, item_id: recoverable.item.item_id, action: "retry" },
    })
    assert(result.data, JSON.stringify(result.error))
    await end((await receipt(request_id)).task_id)
    const updated = (await external.GET("/external/v1/import-batches")).data!.batches.find(
      (b) => b.batch_id === recoverable.batchId,
    )!
    assert.equal(updated.original_overall, "failure")
    assert(updated.items[0].current.complete, JSON.stringify(updated.items[0].current))
    assert.equal(updated.items[0].current.bilibili?.cover?.entity_id, recoverable.coverEntity)
    return updated
  }
  return {
    root,
    library,
    entries,
    recover,
    setup: { profile: "bilibili", entries: entries.map((e) => ({ name: e.name, entityId: e.entityId })) },
    start: async () => server,
    dispose: async () => {
      await server.stop()
      const target = resolve(root)
      assert(target.startsWith(resolve(tmpdir()) + sep))
      await rm(target, { recursive: true, force: true })
    },
  }
}
