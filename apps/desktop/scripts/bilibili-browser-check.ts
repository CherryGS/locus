import { chooseContentView, hasContentView } from "./content-view-choice.ts"
import assert from "node:assert/strict"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { chromium } from "playwright"
import { bilibiliFixture } from "./bilibili-fixture.ts"
import { browserPreview } from "./browser-preview.ts"
import { outputDirectory } from "./fixture.ts"
const data = await bilibiliFixture(),
  backend = await data.start(),
  preview = await browserPreview(backend)
const output = await outputDirectory("bilibili-browser"),
  browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors: string[] = [],
    remote: string[] = [],
    reads: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  page.on("request", (r) => {
    if (new URL(r.url()).origin !== preview.origin) remote.push(r.url())
    if (r.url().includes("/bilibili/")) reads.push(r.url())
  })
  const taskCount = (await backend.client.GET("/api/v1/tasks")).data!.tasks.length
  await page.goto(preview.origin + "/#/entity")
  await page.getByRole("gridcell").first().waitFor()
  const open = async (name: string, kind = "Bilibili") => {
    const entry = data.entries.find((e) => e.name === name)!
    await page.locator('[role="gridcell"][id$="-' + entry.entityId + '"]').dblclick()
    if (
      !(await page.locator("#auxiliary-panel").count()) ||
      (await page.locator("#auxiliary-panel").getAttribute("aria-label")) !== "Overview"
    )
      await page.getByRole("button", { name: "Overview", exact: true }).click()
    if (await hasContentView(page, kind)) await chooseContentView(page, kind)
    await page
      .locator(
        '[data-slot="entity-inspection"][data-view-id="' +
          (kind === "Bilibili" ? "bilibili.read" : "video.play") +
          '"]',
      )
      .waitFor()
    return entry
  }
  const complete = await open("complete")
  const video = page.locator("video")
  const ready = () => page.locator('[data-slot="video-viewport"][data-state="ready"]').waitFor()
  await ready()
  assert.equal(await video.evaluate((v: HTMLVideoElement) => v.paused), true, "Bilibili waits for manual play")
  const originalCover = page.locator('img[alt="Saved Bilibili original cover"]')
  await originalCover.waitFor({ state: "attached" })
  const originalCoverUrl = await originalCover.getAttribute("src")
  assert.equal(await video.getAttribute("poster"), originalCoverUrl)
  assert.equal(
    await page.locator('[data-slot="entity-filmstrip"] [aria-current="true"] img').getAttribute("src"),
    originalCoverUrl,
    "Filmstrip uses the same qualified original cover as card presentation",
  )
  await page.screenshot({ path: join(output, "complete-source.png") })
  await video.evaluate(async (v: HTMLVideoElement) => {
    v.currentTime = 1
    v.volume = 0.4
    v.muted = true
    ;(window as any).__bilibiliEmbedded = v
    await v.play()
  })
  await page.waitForFunction(() => document.querySelector("video")!.currentTime > 1.1)
  const embeddedTime = await video.evaluate((v: HTMLVideoElement) => v.currentTime)
  await chooseContentView(page, "Video")
  await ready()
  assert(await page.evaluate(() => {
    const old = (window as any).__bilibiliEmbedded as HTMLVideoElement
    return old.paused && !old.getAttribute("src") && !old.isConnected
  }), "Leaving the embedded player releases its decoder")
  const continued = await video.evaluate((v: HTMLVideoElement) => ({ time: v.currentTime, paused: v.paused, volume: v.volume, muted: v.muted }))
  assert(continued.paused && Math.abs(continued.time - embeddedTime) < 0.5)
  assert.equal(continued.volume, 0.4)
  assert.equal(continued.muted, true)
  assert.equal(await video.getAttribute("poster"), originalCoverUrl, "Pre-play artwork uses the qualified original")
  await video.evaluate(async (element) => {
    const v = element as HTMLVideoElement
    if (v.readyState < 2)
      await new Promise<void>((resolve) => v.addEventListener("loadeddata", () => resolve(), { once: true }))
    const seeked = new Promise<void>((resolve) =>
      v.addEventListener("seeked", () => resolve(), { once: true }),
    )
    v.currentTime = 1
    await seeked
    v.pause()
    ;(window as any).__bilibiliVideo = v
  })
  const sourceRead = page.waitForResponse((r) =>
    r.url().includes("/bilibili/" + complete.componentId + "/view"),
  )
  await page.getByRole("button", { name: "Reread Entity", exact: true }).first().click()
  await sourceRead
  await page.locator('[data-slot="entity-inspection"][aria-busy="false"]').waitFor()
  assert.equal(
    await video.evaluate(
      (v) => v === (window as any).__bilibiliVideo && Math.abs((v as HTMLVideoElement).currentTime - 1) < 0.2,
    ),
    true,
  )
  assert.equal(await video.evaluate((v) => (v as HTMLVideoElement).paused), true)
  await page.screenshot({ path: join(output, "paused-video.png") })
  await page.getByRole("button", { name: "Return to source", exact: true }).click()
  for (const name of [
    "source-only",
    "locator-only",
    "changed-cover",
    "missing-cover",
    "failed-cover",
    "partial-source",
  ]) {
    const entry = await open(name)
    await page.getByRole("article", { name: "Bilibili capture" }).waitFor()
    if (name === "source-only" || name === "partial-source")
      await page.getByRole("img", { name: "Saved Bilibili original cover", exact: true }).waitFor()
    else await page.getByText("Original cover unavailable", { exact: true }).waitFor()
    if (["source-only", "partial-source", "locator-only"].includes(name)) {
      assert.equal(await video.count(), 0, "An unassociated capture does not play another local File")
      await page.getByText("Local video unavailable.", { exact: false }).waitFor()
    }
    if (["changed-cover", "missing-cover", "failed-cover"].includes(name)) {
      await chooseContentView(page, "Video")
      await page.waitForFunction(() => !!document.querySelector("video")?.poster)
      assert(await video.getAttribute("poster"), "Existing Video frame fallback")
    }
    await page.screenshot({ path: join(output, name + ".png") })
    assert.equal(
      await page.locator('[data-slot="entity-inspection"]').getAttribute("data-entity-id"),
      entry.entityId,
    )
    await page.getByRole("button", { name: "Return to source", exact: true }).click()
  }
  const recoverable = await open("recoverable-cover")
  await video.evaluate(async (element) => {
    const v = element as HTMLVideoElement
    if (v.readyState < 2)
      await new Promise<void>((resolve) => v.addEventListener("loadeddata", () => resolve(), { once: true }))
    const seeked = new Promise<void>((resolve) =>
      v.addEventListener("seeked", () => resolve(), { once: true }),
    )
    v.currentTime = 1
    await seeked
    v.pause()
    ;(window as any).__bilibiliVideo = v
  })
  const coverReread = page.waitForResponse((r) =>
    r.url().includes("/bilibili/" + recoverable.componentId + "/view"),
  )
  const recovered = await data.recover()
  await coverReread
  await page.locator('[data-slot="entity-inspection"][aria-busy="false"]').waitFor()
  assert.equal(
    await video.evaluate(
      (v) => v === (window as any).__bilibiliVideo && Math.abs((v as HTMLVideoElement).currentTime - 1) < 0.2,
    ),
    true,
  )
  assert.equal(await video.evaluate((v) => (v as HTMLVideoElement).paused), true)
  await page.getByText("Captured details", { exact: true }).click()
  await page.getByRole("img", { name: "Saved Bilibili original cover", exact: true }).waitFor()
  await page.screenshot({ path: join(output, "external-recovered-cover.png") })
  assert.equal(recovered.items[0].current.entity_id, recoverable.entityId)
  await page.getByRole("button", { name: "Return to source", exact: true }).click()
  await open("complete")
  // Block this cover resource, preserve Source and its specific failure through a metadata reread.
  await page.route("**/api/v1/previews/*/bytes", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: "operation_failed", message: "Controlled cover resource failure" }),
    }),
  )
  await page.getByRole("button", { name: "Reread Entity", exact: true }).first().click()
  await page.getByRole("button", { name: "Retry original-cover display", exact: true }).waitFor()
  await page.unroute("**/api/v1/previews/*/bytes")
  await page.getByRole("button", { name: "Reread Entity", exact: true }).first().click()
  await page.getByRole("button", { name: "Retry original-cover display", exact: true }).waitFor()
  await page.getByRole("button", { name: "Retry original-cover display", exact: true }).click()
  await page.getByText("Captured details", { exact: true }).click()
  await page.getByRole("img", { name: "Saved Bilibili original cover", exact: true }).waitFor()
  await page.screenshot({ path: join(output, "display-recovered.png") })
  // The Source qualifier and the actual Video input must independently agree.
  const sourcePath = "**/bilibili/" + complete.componentId + "/view"
  for (const mismatch of ["changed", "different-video-input"] as const) {
    await page.route(sourcePath, async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      const otherFile = data.entries.find((e) => e.name === "changed-cover")!.mainFile
      body.applicability.comparison = mismatch === "changed"
        ? { status: "changed", basis: complete.mainFile, current: otherFile }
        : { status: "matching", file_id: otherFile }
      if (mismatch === "different-video-input") body.record.basis = otherFile
      await route.fulfill({ response, json: body })
    })
    await page.getByRole("button", { name: "Reread Entity", exact: true }).first().click()
    await page.getByText("Local video unavailable.", { exact: false }).waitFor()
    assert.equal(await video.count(), 0)
    await page.getByRole("heading", { name: "Bilibili · complete", exact: true }).waitFor()
    await page.unroute(sourcePath)
    await page.getByRole("button", { name: "Reread Entity", exact: true }).first().click()
    await ready()
    assert.equal(await video.evaluate((v: HTMLVideoElement) => v.paused), true)
  }
  await page.getByRole("button", { name: /^Tasks/ }).click()
  await page.getByRole("dialog", { name: "Tasks this run" }).waitFor()
  const dialog = page.getByRole("dialog", { name: "Tasks this run" })
  await dialog.getByRole("button", { name: /Import 2 items/ }).click()
  const partial = data.entries.find((e) => e.name === "partial-source")!
  const partialRow = dialog.locator('[data-import-item-id="' + partial.item.item_id + '"]')
  await partialRow.getByRole("button", { name: "View", exact: true }).waitFor()
  assert.equal(
    await partialRow
      .getByRole("button", { name: /Complete processing|Check original result|Recopy source/ })
      .count(),
    0,
    "External recovery stays with caller",
  )
  assert.equal(partial.item.current.file_attachment.state, "failed")
  await page.screenshot({ path: join(output, "early-source-view-action.png") })
  await partialRow.getByRole("button", { name: "View", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  await page
    .locator(
      '[data-slot="entity-inspection"][data-entity-id="' +
        partial.entityId +
        '"][data-view-id="bilibili.read"]',
    )
    .waitFor()
  await page.getByRole("article", { name: "Bilibili capture" }).waitFor()
  await page.screenshot({ path: join(output, "early-source-view.png") })
  assert.deepEqual(errors, [])
  assert.deepEqual(remote, [])
  assert.equal(
    (await backend.client.GET("/api/v1/tasks")).data!.tasks.length,
    taskCount + 1,
    "Only explicit recovery adds a task; reads never generate content",
  )
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        generatedClient: true,
        externalUploadFirst: true,
        independentCovers: true,
        taskCount,
        componentReads: reads.length,
        errors,
        remote,
        complete: complete.entityId,
      },
      null,
      2,
    ),
  )
  console.log(JSON.stringify({ output, entries: data.entries.length, componentReads: reads.length }))
} finally {
  await browser.close()
  await preview.close()
  await data.dispose()
}
