import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { startServer, workspace } from "./fixture.ts"
import type { ProviderModel, ProviderVersion } from "./sample-library-assets.ts"
export async function civitaiFixture() {
  const root = await mkdtemp(join(tmpdir(), "locus-civitai-check-")),
    library = join(root, "library")
  const response = await promisify(execFile)("just", ["server-civitai-inputs", root], {
    cwd: workspace,
    windowsHide: true,
    timeout: 120000,
  })
  const seed = JSON.parse(response.stdout) as {
    config: string
    cases: { name: string; path: string; hash: string; model: ProviderModel }[]
  }
  let server: Awaited<ReturnType<typeof startServer>> | undefined = await startServer(
    library,
    undefined,
    seed.config,
  )
  const entries: { name: string; entityId: string; componentId?: string; fileId: string }[] = []
  const originalConfig = JSON.parse(await readFile(seed.config, "utf8"))
  // Exercise a dense source directory independently of network availability.
  // Additional declarations are remote facts, not downloaded local weights.
  function enrich(version: ProviderVersion) {
    if (!version.files.length) return
    version.trainedWords = ["fixture-style", "cinematic lighting", "柔和光线", "café portrait", "watercolor landscape", "intricate architecture", "soft shadows", "warm palette", "long trigger phrase with spaces and punctuation, detailed composition", "超长触发词用于验证窄面板换行与文字选择", "a".repeat(96), "final-trigger"]
    version.files.push(
      { id: version.id * 10000 + 1, name: "alternate-full-precision-weight-file-with-a-long-name.safetensors", type: "Model", hashes: {}, sizeKB: 512000, metadata: { format: "SafeTensor", fp: "fp32" } },
      { id: version.id * 10000 + 2, name: "training-data-and-configuration.zip", type: "Training Data", hashes: {}, sizeKB: 1024 },
    )
  }
  for (const item of seed.cases) for (const version of item.model.modelVersions) enrich(version)
  for (const version of Object.values(originalConfig.lookups) as ProviderVersion[]) enrich(version)
  await writeFile(seed.config, JSON.stringify(originalConfig))
  async function phase(name: string) {
    const config = JSON.parse(await readFile(seed.config, "utf8"))
    config.models["1"] = structuredClone(seed.cases.find((c) => c.name === name)!.model)
    if (name === "A") {
      // Current upstream A also discloses the pre-existing local variant. A's
      // earlier retained snapshot still has its own smaller file directory.
      const existing = seed.cases.find((c) => c.name === "existing")!
      config.models["1"].modelVersions[0].files.push(originalConfig.lookups[existing.hash].files[0])
    }
    await writeFile(seed.config, JSON.stringify(config))
  }
  for (const item of seed.cases) {
    await phase(item.name)
    if (item.name === "existing") {
      const config = JSON.parse(await readFile(seed.config, "utf8"))
      delete config.lookups[item.hash]
      await writeFile(seed.config, JSON.stringify(config))
    }
    const receipt = await server.client.POST("/api/v1/import-batches", {
      body: { request_id: randomUUID(), source_paths: [item.path] },
    })
    assert(receipt.data)
    for (let n = 0; n < 600; n++) {
      const snapshot = (await server.client.GET("/api/v1/import-batches")).data!
      const batch = snapshot.batches.find((b) => b.original_request_id === receipt.data!.request_id)
      if (batch?.original_ended) {
        const current = batch.items[0].current
        assert(current.complete, JSON.stringify(current))
        entries.push({
          name: item.name,
          entityId: current.confirmed_entity_id!,
          fileId: current.confirmed_file_id!,
          componentId: current.civitai?.component_id ?? undefined,
        })
        break
      }
      await delay(50)
    }
  }
  assert.equal(entries.length, 4)
  const config = JSON.parse(await readFile(seed.config, "utf8"))
  config.lookups = originalConfig.lookups
  await writeFile(seed.config, JSON.stringify(config))
  await phase("A")
  await server.stop()
  server = undefined
  return {
    root,
    library,
    entries,
    seed,
    phase,
    setup: { entityCount: entries.length, profile: "civitai", entries },
    async start() {
      return (server = await startServer(library, undefined, seed.config))
    },
    async stop() {
      await server?.stop()
      server = undefined
    },
    async dispose() {
      await server?.stop()
      assert(resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes("locus-civitai-check-"))
      await rm(root, { recursive: true, force: true })
    },
  }
}
