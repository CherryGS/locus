import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { promisify } from "node:util"
import { startServer } from "./fixture.ts"

export async function videoFixture() {
  const root = await mkdtemp(join(tmpdir(), "locus-video-check-"))
  const library = join(root, "library")
  const server = await startServer(library)
  const videos: {
    entityId: string
    fileId: string
    componentId: string
    relativePath: string
    source: string
  }[] = []
  const complete = async (task: string) => {
    const deadline = AbortSignal.timeout(30_000)
    for (;;) {
      const value = await server.client.GET("/api/v1/tasks/{task_id}/outcome", {
        params: { path: { task_id: task } },
        signal: deadline,
      })
      assert(value.data)
      if (value.data.status === "complete") return value.data.outcome
      await delay(10, undefined, { signal: deadline })
    }
  }
  try {
    for (const [name, codec] of [
      ["a.mp4", "libx264"],
      ["b.webm", "libvpx-vp9"],
      ["unsupported.mkv", "ffv1"],
    ]) {
      const source = join(root, name)
      await promisify(execFile)(
        process.env.LOCUS_FFMPEG ?? "ffmpeg",
        [
          "-v",
          "error",
          "-nostdin",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=s=320x180:r=24:d=30",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:duration=30",
          "-c:v",
          codec,
          "-threads",
          "1",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          name.endsWith("mp4") ? "aac" : "libopus",
          "-y",
          source,
        ],
        { windowsHide: true },
      )
      const imported = await server.client.POST("/api/v1/imports", {
        body: { request_id: randomUUID(), source_path: source },
      })
      assert(imported.data)
      const result = await complete(imported.data.task_id)
      assert(result.status === "imported")
      const entity = await server.client.POST("/api/v1/entities", { body: { request_id: randomUUID() } })
      const media = await server.client.POST("/api/v1/media", {
        body: { request_id: randomUUID(), kind: "video" },
      })
      assert(entity.data?.status === "entity_created" && media.data?.status === "media_created")
      const memberships: string[][] = [
        [result.file.kind_id, result.file.file_id],
        [media.data.kind_id, media.data.target.component_id],
      ]
      for (const [kind_id, component_id] of memberships) {
        assert.equal(
          (
            await server.client.POST("/api/v1/memberships/attach", {
              body: {
                request_id: randomUUID(),
                membership: { entity_id: entity.data.entity_id, kind_id, component_id },
              },
            })
          ).data?.status,
          "attached",
        )
      }
      const interpreted = await server.client.POST("/api/v1/interpretations", {
        body: { request_id: randomUUID(), target: media.data.target },
      })
      assert(interpreted.data)
      const facts = await complete(interpreted.data.task_id)
      assert(
        facts.status === "interpreted" &&
          facts.result.status === "accepted" &&
          !facts.result.record.last_failure,
      )
      videos.push({
        entityId: entity.data.entity_id,
        fileId: result.file.file_id,
        componentId: media.data.target.component_id,
        relativePath: result.file.relative_path,
        source,
      })
    }
  } finally {
    await server.stop()
  }
  return {
    root,
    library,
    videos,
    dispose: async () => {
      assert(resolve(root).startsWith(resolve(tmpdir()) + sep))
      await rm(root, { recursive: true, force: true })
    },
  }
}
