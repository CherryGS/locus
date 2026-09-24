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
    const use = page.getByRole("button", { name: "Use " + kind + " view", exact: true })
    if (await use.count()) await use.click()
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
  const originalCover = page.getByRole("img", { name: "Saved Bilibili original cover", exact: true })
  await originalCover.waitFor()
  const originalCoverUrl = await originalCover.getAttribute("src")
  assert.equal(
    await page.locator('[data-slot="entity-filmstrip"] [aria-current="true"] img').getAttribute("src"),
    originalCoverUrl,
    "Filmstrip uses the same qualified original cover as card presentation",
  )
  await page.screenshot({ path: join(output, "complete-source.png") })
  await page.getByRole("button", { name: "Use Video view", exact: true }).click()
  const video = page.locator("video")
  await video.waitFor()
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
    if (["changed-cover", "missing-cover", "failed-cover"].includes(name)) {
      await page.getByRole("button", { name: "Use Video view", exact: true }).click()
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
  const recoverable = await open("recoverable-cover", "Video")
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
  await page.getByRole("button", { name: "Use Bilibili view", exact: true }).click()
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
  await page.getByRole("img", { name: "Saved Bilibili original cover", exact: true }).waitFor()
  await page.screenshot({ path: join(output, "display-recovered.png") })
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
