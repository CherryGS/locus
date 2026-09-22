import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import { startServer, workspace } from "./fixture.ts"
export type TwitterFixtureEntry = { name: string; entityId: string; componentId: string; fileId: string | null }
export async function twitterFixture(withVideo = false) {
  const root = await mkdtemp(join(tmpdir(), "locus-twitter-check-"))
  const library = join(root, "library")
  const video = join(root, "local-video.mp4")
  if (withVideo) await promisify(execFile)(process.env.LOCUS_FFMPEG ?? "ffmpeg", ["-v","error","-nostdin","-f","lavfi","-i","testsrc2=s=320x180:r=24:d=10","-c:v","libx264","-threads","1","-pix_fmt","yuv420p",video], {windowsHide:true})
  const result = await promisify(execFile)("just", ["server-twitter-fixture", library, ...(withVideo ? [video] : [])], { cwd: workspace, windowsHide: true, timeout: 120000 })
  const seeded = JSON.parse(result.stdout) as { entries: TwitterFixtureEntry[] }
  let server: Awaited<ReturnType<typeof startServer>> | undefined
  return { root, library, entries: seeded.entries,
    async start() { server = await startServer(library); return server },
    async stop() { await server?.stop(); server = undefined },
    async dispose() {
      await server?.stop()
      assert(resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes("locus-twitter-check-"))
      await rm(root, { recursive: true, force: true })
    },
  }
}
