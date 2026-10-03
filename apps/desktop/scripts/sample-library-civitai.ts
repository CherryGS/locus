import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, join, relative, resolve } from "node:path"
import { chromium } from "playwright"
import { browserPreview } from "./browser-preview.ts"
import { startServer } from "./fixture.ts"
import type { ProviderConfig, ProviderModel, ProviderVersion } from "./sample-library-assets.ts"
import { sampleSession, type Manifest } from "./sample-library-session.ts"
import type { components } from "@locus/client"

type PublicVersion = Omit<ProviderVersion, "files" | "images"> & {
  trainedWords?: string[]
  files: (ProviderVersion["files"][number] & {
    downloadUrl: string
    hashes: { BLAKE3?: string; SHA256?: string }
  })[]
  images: (ProviderVersion["images"][number] & { nsfwLevel?: number })[]
}
type PublicModel = Omit<ProviderModel, "modelVersions"> & { modelVersions: PublicVersion[] }

// Real bytes and API snapshots remain outside Git. Replay only the selected
// version's two general-audience examples; preserve the complete API response
// separately so the reduced fixture never claims to be the full upstream roster.
export async function extendCivitaiSamples(root: string) {
  root = resolve(root)
  const manifestPath = join(root, "manifest.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest
  assert.equal(resolve(manifest.root), root)
  const config = JSON.parse(await readFile(manifest.providerConfig, "utf8")) as ProviderConfig
  const samples = [
    { model: 522077, version: 580050, name: "Agnes-multiple-triggers", files: [495504] },
    { model: 4629, version: 5637, name: "DeepNegative-multiple-files", files: [1186961, 5845] },
  ]
  const admissions: { name: string; path: string; expected: string }[] = []
  for (const sample of samples) {
    const directory = join(root, "inputs", "civitai-public", String(sample.model))
    await mkdir(directory, { recursive: true })
    const url = `https://civitai.com/api/v1/models/${sample.model}`
    console.log(`Reading public Civitai model ${sample.model}`)
    const source = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    assert(source.ok, `${url}: HTTP ${source.status}`)
    const original = await source.text()
    const model = JSON.parse(original) as PublicModel
    assert.equal(model.id, sample.model)
    const version = model.modelVersions.find(item => item.id === sample.version)
    assert(version && version.files.length && Array.isArray(version.trainedWords))
    if (sample.model === 522077) assert(version.trainedWords.length >= 2)
    if (sample.model === 4629) assert(version.files.length >= 2)
    await writeFile(join(directory, "upstream-model.json"), original)
    const files: { path: string; url: string; sha256: string; bytes: number }[] = []
    for (const fileId of sample.files) {
      const file: PublicVersion["files"][number] | undefined = version.files.find(item => item.id === fileId)
      assert(file?.hashes.BLAKE3 && file.hashes.SHA256 && file.downloadUrl)
      assert.equal(basename(file.name), file.name)
      const path = join(directory, file.name)
      let bytes: Buffer
      try {
        bytes = await readFile(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        console.log(`Downloading ${file.name}`)
        const response = await fetch(file.downloadUrl, { signal: AbortSignal.timeout(180_000) })
        assert(response.ok, `${file.name}: HTTP ${response.status}`)
        bytes = Buffer.from(await response.arrayBuffer())
        await writeFile(path, bytes)
      }
      const sha256 = createHash("sha256").update(bytes).digest("hex")
      assert.equal(sha256, file.hashes.SHA256.toLowerCase(), file.name)
      files.push({ path: relative(root, path), url: file.downloadUrl, sha256, bytes: bytes.length })
      config.lookups[file.hashes.BLAKE3.toLowerCase()] = version
      admissions.push({
        name: `retained/${sample.name}/${file.name}`,
        path,
        expected: `Real hash-matched Civitai model ${sample.model}, version ${sample.version}; ${version.trainedWords.length} trigger phrases and ${version.files.length} listed files; two retained general-audience previews`,
      })
    }
    const examples = version.images.filter(image => image.type === "image" && image.nsfwLevel === 1).slice(0, 2)
    assert.equal(examples.length, 2, "Expected two general-audience examples")
    for (const [index, image] of examples.entries()) {
      const response = await fetch(image.url, { signal: AbortSignal.timeout(60_000) })
      assert(response.ok, `Example ${index + 1}: HTTP ${response.status}`)
      const bytes = Buffer.from(await response.arrayBuffer())
      const path = join(directory, `example-${index + 1}.jpg`)
      await writeFile(path, bytes)
      config.examples[image.url] = path
      files.push({ path: relative(root, path), url: image.url, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") })
    }
    for (const item of model.modelVersions) item.images = item.id === version.id ? examples : []
    version.modelId = model.id
    config.models[String(model.id)] = model
    await writeFile(join(directory, "provenance.json"), JSON.stringify({
      source: url, acquiredAt: new Date().toISOString(), model: model.id, version: version.id,
      upstreamSha256: createHash("sha256").update(original).digest("hex"), files,
      replay: "Complete source metadata retained separately; only two general-audience examples of the admitted version replayed. Model weights are never executed.",
    }, null, 2))
  }
  await writeFile(manifest.providerConfig, JSON.stringify(config, null, 2))
  const session = await sampleSession(manifest.library, manifest.providerConfig)
  try {
    for (const sample of admissions) {
      if (manifest.cases.some(entry => entry.name === sample.name)) continue
      console.log("Admitting " + sample.name)
      const result = await session.admit(sample.path)
      assert(result.complete, JSON.stringify(result))
      const pickleCompanion = sample.path.endsWith(".pt")
      assert(pickleCompanion || result.civitai?.state === "complete", JSON.stringify(result))
      const view = result.civitai?.component_id ? "civitai.read" : "file.info"
      await session.preference(result.confirmed_entity_id!, view)
      manifest.cases.push({ name: sample.name, entityId: result.confirmed_entity_id!, fileId: result.confirmed_file_id!,
        view, expected: pickleCompanion ? "Real PickleTensor companion retained as File; listed beside the SafeTensor in Deep Negative's saved version. No Model recognition or execution is claimed." : sample.expected,
        provenance: "retained", input: relative(root, sample.path), result })
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
    }
  } finally {
    await session.server.stop()
  }
  const guide = join(root, "civitai-public.md")
  await writeFile(guide, `# Public Civitai reading samples\n\n${samples.map(sample => `- [${sample.name}](https://civitai.com/models/${sample.model}?modelVersionId=${sample.version})`).join("\n")}\n\nActual model files have been verified against upstream SHA-256 and admitted through the ordinary import API. Full source snapshots and provenance are in inputs/civitai-public. The offline replay retains two general-audience previews per selected version. The .pt file is retained as data, never executed. Preview links for every new Entity are in preview.md after restarting sample:preview.\n`)
  console.log(JSON.stringify({ addedCases: admissions.map(sample => sample.name), guide }))
}

export async function verifyCivitaiSamples(root: string) {
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as Manifest
  const entries = manifest.cases.filter(entry => entry.name.startsWith("retained/Agnes-multiple-triggers/") || entry.name.startsWith("retained/DeepNegative-multiple-files/"))
  assert.equal(entries.length, 3)
  const backend = await startServer(manifest.library, undefined, manifest.providerConfig)
  const preview = await browserPreview(backend)
  const browser = await chromium.launch({ headless: true })
  const output = join(root, "verification", "civitai-public")
  await mkdir(output, { recursive: true })
  const evidence: unknown[] = []
  const originalCovers = new Map<string, components["schemas"]["CardCoverSelection"] | null>()
  try {
    for (const entry of entries) {
      const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
      const component_id = entry.result.civitai?.component_id
      if (!component_id) {
        assert(entry.name.endsWith(".pt") && entry.view === "file.info")
        await page.close()
        continue
      }
      const response = await backend.client.GET("/api/v1/civitai/{component_id}/page", { params: { path: { component_id } } })
      assert(response.data?.origin.input === "current")
      const model = response.data.origin.record.model
      const version = await backend.client.GET("/api/v1/civitai/{component_id}/version", { params: {
        path: { component_id }, query: { version: response.data.origin.record.matched_version },
      } })
      assert(version.data)
      const words = JSON.parse(version.data.version.raw_json).trainedWords as string[]
      assert.equal(words.length, model.id === "522077" ? 2 : 1)
      assert.equal(version.data.version.files.length, model.id === "522077" ? 1 : 2)
      assert.equal(version.data.examples.length, 2)
      assert(version.data.examples.every(example => example.applicable && example.binding.complete))
      const original = await backend.client.GET("/api/v1/entities/{entity_id}/card-cover-preference", { params: { path: { entity_id: entry.entityId } } })
      assert(original.data && original.data.status !== "missing")
      const originalCover = original.data.status === "saved" ? original.data.cover : null
      originalCovers.set(entry.entityId, originalCover)
      if (original.data.status === "saved" && originalCover) {
        const cleared = await backend.client.PUT("/api/v1/entities/{entity_id}/card-cover-preference", { params: { path: { entity_id: entry.entityId } }, body: { request_id: randomUUID(), expected_revision: original.data.revision, cover: null } })
        assert.equal(cleared.data?.status, "card_cover_preference_saved")
      }
      await page.goto(`${preview.origin}/#/entity?mode=inspect&entityId=${entry.entityId}`)
      const reader = page.locator('[data-slot="civitai-page"]')
      await reader.getByRole("row", { name: /^Trigger words/ }).waitFor()
      await page.getByRole("button", { name: "Civitai", exact: true }).click()
      const panel = page.getByRole("complementary", { name: "Civitai", exact: true })
      assert.equal(await panel.locator(":scope > header").count(), 0)
      assert.equal(await reader.getByRole("button", { name: "Open library and source", exact: true }).count(), 0)
      await reader.getByRole("region", { name: "Version information", exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(output, `${model.id}-wide.png`) })
      // Select a different saved image, without changing the content-view
      // preference or the gallery's fresh-entry default.
      const defaultView = await backend.client.GET("/api/v1/entities/{entity_id}/view-preference", { params: { path: { entity_id: entry.entityId } } })
      const gallery = reader.getByRole("region", { name: "Managed Civitai examples", exact: true })
      const galleryImage = await gallery.locator('[data-slot="civitai-gallery-stage"] img').getAttribute("src")
      const savedCover = page.waitForResponse(response => response.url().endsWith(`/${entry.entityId}/card-cover-preference`) && response.request().method() === "PUT")
      await gallery.getByRole("button", { name: "Set example 2 as card cover", exact: true }).click()
      assert((await savedCover).ok())
      await gallery.locator('[data-card-cover="true"]').waitFor()
      assert.equal(await gallery.locator('[data-card-cover="true"]').count(), 1)
      assert.equal(await gallery.getByRole("button", { name: "Show example 1", exact: true }).getAttribute("aria-pressed"), "true", "cover controls do not change gallery browsing")
      assert.equal(await gallery.locator('[data-slot="civitai-gallery-stage"] img').getAttribute("src"), galleryImage)
      assert(await gallery.getByRole("button", { name: "Use automatic card cover", exact: true }).evaluate(element => element === document.activeElement), "cover save retains focus on its thumbnail marker")
      const strip = gallery.locator('[data-slot="civitai-gallery-strip"] [data-slot="scroll-area-viewport"]')
      const filmstrip = await strip.evaluate(element => {
        element.scrollTop = 20
        const viewport = element.getBoundingClientRect()
        const marker = element.querySelector('[aria-label="Use automatic card cover"]')!.getBoundingClientRect()
        const thumbnail = element.querySelector('[data-card-cover="true"] [data-slot="toggle-group-item"]')!.getBoundingClientRect()
        return { height: element.clientHeight, content: element.scrollHeight, scrollTop: element.scrollTop,
          markerInside: marker.top >= viewport.top + 2 && marker.bottom <= viewport.bottom - 2,
          markerCentered: Math.abs((marker.left + marker.right) / 2 - (thumbnail.left + thumbnail.right) / 2) < 1,
          markerAtBorder: marker.top < thumbnail.top && marker.bottom > thumbnail.top }
      })
      assert(filmstrip.content <= filmstrip.height && filmstrip.scrollTop === 0, "focused filmstrip cannot scroll vertically and crop its border")
      assert(filmstrip.markerInside && filmstrip.markerCentered && filmstrip.markerAtBorder, "cover marker interrupts the top border with room for keyboard focus")
      if (model.id === "4629") {
        await reader.getByRole("button", { name: "V1 64T · Version 5638", exact: true }).click()
        await gallery.getByText("No saved examples for this version", { exact: true }).waitFor()
        assert.equal(await gallery.locator('[data-card-cover="true"]').count(), 0)
        assert.equal(await gallery.getByRole("button", { name: "Use automatic card cover", exact: true }).count(), 1, "a cover from another version remains visible in existing gallery controls")
        await reader.getByRole("button", { name: "V1 75T · Version 5637", exact: true }).click()
        await gallery.locator('[data-card-cover="true"]').waitFor()
      }
      const preference = await backend.client.GET("/api/v1/entities/{entity_id}/card-cover-preference", { params: { path: { entity_id: entry.entityId } } })
      assert(preference.data?.status === "saved" && preference.data.cover)
      assert.deepEqual((await backend.client.GET("/api/v1/entities/{entity_id}/view-preference", { params: { path: { entity_id: entry.entityId } } })).data, defaultView.data)
      await page.reload()
      await reader.waitFor()
      await reader.getByRole("button", { name: "Use automatic card cover", exact: true }).waitFor()
      await reader.getByRole("button", { name: "Show example 1", exact: true }).waitFor()
      assert.equal(await reader.getByRole("button", { name: "Show example 1", exact: true }).getAttribute("aria-pressed"), "true")
      await page.goto(`${preview.origin}/#/entity?mode=grid&collectionId=library&entityId=${entry.entityId}`)
      const grid = page.getByRole("grid", { name: "Entities", exact: true })
      const card = grid.locator(`[data-entity-id="${entry.entityId}"]`)
      await card.locator("img").waitFor()
      await grid.evaluate(element => { element.scrollTop = 0 })
      await page.getByRole("button", { name: "Locate selected Entity", exact: true }).click()
      await page.waitForFunction(entityId => {
        const card = document.querySelector(`[role="grid"] [data-entity-id="${entityId}"]`)
        const grid = card?.closest('[role="grid"]')
        if (!card || !grid) return false
        const cardBounds = card.getBoundingClientRect(), gridBounds = grid.getBoundingClientRect()
        return cardBounds.bottom > gridBounds.top && cardBounds.top < gridBounds.bottom && document.activeElement === grid
      }, entry.entityId)
      const located = await card.evaluate(element => {
        const card = element.getBoundingClientRect(), grid = element.closest('[role="grid"]')!.getBoundingClientRect()
        return card.bottom > grid.top && card.top < grid.bottom && document.activeElement === element.closest('[role="grid"]')
      })
      assert(located, "locate reveals and focuses the current Entity without changing selection")
      await page.screenshot({ path: join(output, `${model.id}-grid-cover.png`) })
      await page.goto(`${preview.origin}/#/entity?mode=inspect&entityId=${entry.entityId}`)
      await reader.getByRole("button", { name: "Use automatic card cover", exact: true }).waitFor()
      const reset = page.waitForResponse(response => response.url().endsWith(`/${entry.entityId}/card-cover-preference`) && response.request().method() === "PUT")
      await reader.getByRole("button", { name: "Use automatic card cover", exact: true }).click()
      assert((await reset).ok())
      await page.getByRole("button", { name: "Civitai", exact: true }).click()
      await page.setViewportSize({ width: 720, height: 480 })
      const bounds = await reader.evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }))
      assert(bounds.content <= bounds.width + 1)
      assert(await strip.evaluate(element => element.scrollHeight <= element.clientHeight && element.scrollTop === 0), "narrow filmstrip stays horizontal-only")
      const selectedVersion = await reader.locator('[aria-label="Civitai version"] [aria-pressed="true"]').getAttribute("aria-label")
      await page.getByRole("button", { name: "Civitai", exact: true }).click()
      await panel.waitFor({ state: "detached" })
      assert.equal(await reader.locator('[aria-label="Civitai version"] [aria-pressed="true"]').getAttribute("aria-label"), selectedVersion)
      await page.screenshot({ path: join(output, `${model.id}-narrow.png`) })
      evidence.push({ entity: entry.entityId, model: model.id, triggers: words.length, files: version.data.version.files.length, examples: version.data.examples.length })
      await page.close()
    }
    await writeFile(join(output, "result.json"), JSON.stringify({ status: "PASS", cases: evidence }, null, 2))
    console.log(JSON.stringify({ status: "PASS", output, cases: evidence }))
  } finally {
    try {
      for (const [entity_id, cover] of originalCovers) {
        const current = await backend.client.GET("/api/v1/entities/{entity_id}/card-cover-preference", { params: { path: { entity_id } } })
        assert(current.data && current.data.status !== "missing")
        const currentCover = current.data.status === "saved" ? current.data.cover : null
        if (JSON.stringify(currentCover) === JSON.stringify(cover)) continue
        const restored = await backend.client.PUT("/api/v1/entities/{entity_id}/card-cover-preference", { params: { path: { entity_id } }, body: { request_id: randomUUID(), expected_revision: current.data.status === "saved" ? current.data.revision : null, cover } })
        assert.equal(restored.data?.status, "card_cover_preference_saved", "restore the preview user's original cover choice")
      }
    } finally {
      await browser.close()
      await preview.close()
      await backend.stop()
    }
  }
}
