import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import { startServer, workspace } from "./fixture.ts"
export type ModelFixtureEntry = {
  name: string
  entityId: string
  componentId: string
  fileId: string | null
}
export async function modelFixture() {
  const root = await mkdtemp(join(tmpdir(), "locus-model-check-"))
  const library = join(root, "library")
  const result = await promisify(execFile)("just", ["server-model-fixture", library], {
    cwd: workspace,
    windowsHide: true,
    timeout: 120000,
  })
  const seeded = JSON.parse(result.stdout) as { entries: ModelFixtureEntry[] }
  let server: Awaited<ReturnType<typeof startServer>> | undefined
  return {
    root,
    library,
    entries: seeded.entries,
    setup: { entityCount: seeded.entries.length },
    async start() {
      server = await startServer(library)
      return server
    },
    async stop() {
      await server?.stop()
      server = undefined
    },
    async dispose() {
      await server?.stop()
      assert(resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes("locus-model-check-"))
      await rm(root, { recursive: true, force: true })
    },
  }
}
