import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"
import { chromium } from "playwright"
import type { components } from "@locus/client"
import { fixture, outputDirectory } from "./fixture.ts"
import { browserPreview } from "./browser-preview.ts"
import { externalTaskBrowser, saveIsolatedExternalAddress } from "./external-task-browser.ts"

const data = await fixture()
let backend = await data.start()
await saveIsolatedExternalAddress(backend)
await backend.stop()
backend = await data.start()
const preview = await browserPreview(backend)
const output = await outputDirectory("shared-tasks"),
  browser = await chromium.launch({ headless: true })
async function terminal(id: string) {
  const signal = AbortSignal.timeout(15_000)
  for (;;) {
    const value = await backend.client.GET("/api/v1/tasks/{task_id}/outcome", {
      params: { path: { task_id: id } },
      signal,
    })
    assert(value.data)
    if (value.data.status === "complete") return value.data.outcome
    await delay(10, undefined, { signal })
  }
}
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.setViewportSize({ width: 720, height: 480 })
  await page.goto(`${preview.origin}/#/entity`)
  const grid = page.getByRole("grid", { name: "Entities" })
  await grid.waitFor()
  await grid.evaluate((element) => {
    element.scrollTop = 150
    ;(window as any).__retainedGrid = element
  })
  await page.waitForFunction(() => ((window as any).__retainedGrid as HTMLElement).scrollTop > 0)
  const gridScroll = await grid.evaluate((element) => element.scrollTop)
  const gridDestination = page.url()
  await page.getByRole("button", { name: /^Tasks/ }).click()
  await page.getByRole("dialog", { name: "Tasks this run" }).waitFor()
  await page.keyboard.press("Escape")
  await page.getByRole("dialog", { name: "Tasks this run" }).waitFor({ state: "hidden" })
  assert.equal(page.url(), gridDestination)
  assert.equal(
    await grid.evaluate(
      (element) =>
        element === (window as any).__retainedGrid &&
        element.scrollTop === (window as any).__retainedGrid.scrollTop,
    ),
    true,
  )
  assert.equal(await grid.evaluate((element) => element.scrollTop), gridScroll)
  assert.equal(
    await page
      .getByRole("button", { name: /^Tasks/ })
      .evaluate((element) => element === document.activeElement),
    true,
  )
  await grid.evaluate((element) => {
    element.scrollTop = 0
  })
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.getByRole("gridcell").first().dblclick()
  await page.locator('[data-slot="image-viewport"][data-state="ready"]').waitFor()
  await page.getByRole("button", { name: "Overview", exact: true }).click()
  const image = page.locator('[data-slot="image-viewport"]')
  await image.focus()
  await page.keyboard.press("+")
  const imageTransform = await image.locator("img").evaluate((element) => element.style.transform)
  const imageBox = await image.boundingBox()
  const initial = page.url()
  let listReads = 0
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/entities") listReads++
  })
  const source = join(data.root, "ordinary.txt"),
    missing = join(data.root, "recopy.txt")
  await writeFile(source, "ordinary source")
  const original = await backend.client.POST("/api/v1/import-batches", {
    body: { request_id: randomUUID(), source_paths: [source, missing] },
  })
  assert(original.data)
  await terminal(original.data.task_id)
  await page.getByRole("button", { name: /Tasks.*1 records.*1 need attention/ }).waitFor()
  assert.equal(await page.getByRole("dialog", { name: "Tasks this run" }).isVisible(), false)
  const originalSnapshot = (await backend.client.GET("/api/v1/import-batches")).data!
  const batch = originalSnapshot.batches[0],
    item = batch.items.find((value) => value.source_path === missing)!
  await writeFile(missing, "explicit new copy")
  const recovered = await backend.client.POST("/api/v1/import-recoveries", {
    body: { request_id: randomUUID(), batch_id: batch.batch_id, item_id: item.item_id, action: "recopy" },
  })
  assert(recovered.data)
  await terminal(recovered.data.task_id)
  const file = await backend.client.POST("/api/v1/imports", {
    body: { request_id: randomUUID(), source_path: source },
  })
  assert(file.data)
  await terminal(file.data.task_id)
  const target = { kind: "image" as const, component_id: data.images[0].componentId }
  const success = await backend.client.POST("/api/v1/interpretations", {
    body: { request_id: randomUUID(), target },
  })
  assert(success.data)
  const successOutcome = await terminal(success.data.task_id)
  assert(
    successOutcome.status === "interpreted" &&
      successOutcome.result.status === "accepted" &&
      !successOutcome.result.record.last_failure,
  )
  const unmounted = await backend.client.POST("/api/v1/media", {
    body: { request_id: randomUUID(), kind: "image" },
  })
  assert(unmounted.data?.status === "media_created")
  const warning = await backend.client.POST("/api/v1/interpretations", {
    body: { request_id: randomUUID(), target: unmounted.data.target },
  })
  assert(warning.data)
  const warningOutcome = await terminal(warning.data.task_id)
  assert(
    warningOutcome.status === "interpreted" &&
      warningOutcome.result.status === "accepted" &&
      warningOutcome.result.record.last_failure,
  )
  const generated = await backend.client.POST("/api/v1/previews", {
    body: { request_id: randomUUID(), target, edge: 128 },
  })
  assert(generated.data)
  await terminal(generated.data.task_id)
  await page.getByRole("button", { name: /Tasks.*5 records.*1 need attention/ }).waitFor()
  assert.equal(page.url(), initial)
  assert.equal(listReads, 0)
  await page.getByRole("button", { name: /^Tasks/ }).click()
  const region = page.getByRole("dialog", { name: "Tasks this run" })
  assert.equal(await region.locator("[data-task-record]").count(), 5)
  const filter = (label: string) =>
    region.locator(`[data-slot="toggle-group-item"][aria-label="${label}"]`).click()
  await filter("Needs attention")
  assert.equal(await region.locator("[data-task-record]").count(), 1)
  await filter("Finished")
  assert.equal(await region.locator("[data-task-record]").count(), 4)
  await filter("Active")
  await region.getByRole("button", { name: "Show all tasks", exact: true }).waitFor()
  await region.getByRole("button", { name: "Show all tasks", exact: true }).click()
  await region.getByRole("textbox", { name: "Search tasks", exact: true }).fill("recopy.txt")
  assert.equal(await region.locator("[data-task-record]").count(), 1)
  await region.getByRole("textbox", { name: "Search tasks", exact: true }).fill(batch.batch_id)
  assert.equal(await region.locator("[data-task-record]").count(), 1)
  await region.getByRole("textbox", { name: "Search tasks", exact: true }).fill("no-such-task")
  assert.equal(await region.locator("[data-task-record]").count(), 0)
  await region.getByRole("button", { name: "Show all tasks", exact: true }).click()
  assert.equal(await region.locator("[data-task-record]").count(), 5)

  const batchEntry = region.locator(`[data-task-record="${batch.batch_id}"]`)
  const batchDetails = region.locator(`[data-task-detail="${batch.batch_id}"]`)
  const recoveredFile = batchDetails.locator("article").filter({ hasText: missing })
  await batchEntry.click()
  await recoveredFile.getByText("Details", { exact: true }).click()
  await recoveredFile.getByText("Original and recovery attempts (2)", { exact: true }).click()
  const standaloneEntry = region.locator(`[data-task-record="${success.data.task_id}"]`)
  await region.getByRole("button", { name: "Check results", exact: true }).focus()
  await page.keyboard.press("Alt+ArrowLeft")
  assert.equal(page.url(), initial, "task focus owns history keys")
  for (let index = 0; index < 25; index++) {
    await page.keyboard.press("Tab")
    // Base UI's sentinel redirects focus on its queued focus frame.
    await page.waitForFunction(() => !!document.activeElement?.closest('[role="dialog"][data-open]'))
    assert(
      await region.evaluate((element) => element.contains(document.activeElement)),
      `modal traps keyboard focus: ${await page.evaluate(() => document.activeElement?.outerHTML)}`,
    )
  }
  await assert.rejects(
    page.locator('button[aria-label="Next entity"]').click({ trial: true, timeout: 250 }),
    "background navigation is inert",
  )
  assert.deepEqual(await image.boundingBox(), imageBox, "modal does not resize the image surface")
  assert.equal(await image.locator("img").evaluate((element) => element.style.transform), imageTransform)
  await page.keyboard.press("Escape")
  await region.waitFor({ state: "hidden" })
  assert.equal(page.url(), initial, "task Escape must not exit inspection")
  assert.equal(
    await page
      .getByRole("button", { name: /^Tasks/ })
      .evaluate((element) => element === document.activeElement),
    true,
  )
  assert.equal(await image.locator("img").evaluate((element) => element.style.transform), imageTransform)
  await page.getByRole("button", { name: "Next entity", exact: true }).click()
  await page.waitForURL((url) => url.href !== initial)
  const destination = page.url()
  await page.getByRole("button", { name: /^Tasks/ }).click()
  // Explicit fault injection: a bounded target-presence failure stays at the caller.
  let releaseRefresh!: () => void
  let sawRefresh!: () => void
  const heldRefresh = new Promise<void>((resolve) => {
    releaseRefresh = resolve
  })
  const requestedRefresh = new Promise<void>((resolve) => {
    sawRefresh = resolve
  })
  await page.route("**/api/v1/memberships/read", async (route) => {
    sawRefresh()
    await heldRefresh
    await route.fulfill({
      status: 500,
      json: { code: "operation_failed", message: "test refresh unavailable" },
    })
  })
  await recoveredFile.getByRole("button", { name: "View", exact: true }).click()
  await requestedRefresh
  await standaloneEntry.focus()
  await page.keyboard.press("Enter")
  assert.equal(await standaloneEntry.getAttribute("aria-current"), "true")
  assert.equal(await batchDetails.isVisible(), false)
  assert.equal(await region.locator("[data-task-detail]:visible").count(), 1)
  releaseRefresh()
  await batchDetails
    .filter({ hasText: /Unable to observe imported Entity .*test refresh unavailable/ })
    .waitFor({ state: "attached" })
  assert.equal(
    await standaloneEntry.getAttribute("aria-current"),
    "true",
    "a late View failure does not change task selection",
  )
  await batchEntry.click()
  await batchDetails.getByText(/Unable to observe imported Entity .*test refresh unavailable/).waitFor()
  assert.equal(
    await recoveredFile.getByText("Original and recovery attempts (2)", { exact: true }).isVisible(),
    true,
  )
  assert.equal(page.url(), destination)
  await page.unroute("**/api/v1/memberships/read")
  for (const viewport of [
    { width: 1200, height: 800 },
    { width: 720, height: 480 },
  ]) {
    await page.setViewportSize(viewport)
    await page.waitForFunction(() => {
      const popup = document.querySelector('[role="dialog"][data-open]')
      const bounds = popup?.getBoundingClientRect()
      return !!bounds && bounds.y >= 0 && bounds.bottom <= innerHeight
    })
    const bounds = await region.boundingBox()
    assert(
      bounds && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height,
      JSON.stringify({ bounds, viewport }),
    )
    const detailsViewport = batchDetails.getByLabel("Task details", { exact: true })
    const scroll = await detailsViewport.evaluate((element) => ({
      height: element.clientHeight,
      content: element.scrollHeight,
      width: element.clientWidth,
      contentWidth: element.scrollWidth,
    }))
    assert(
      scroll.content > scroll.height && scroll.height > 100,
      "long details scroll below the modal header",
    )
    assert(scroll.contentWidth <= scroll.width + 1, "details must not overflow horizontally")
    await detailsViewport.evaluate((element) => {
      element.scrollTop = 120
    })
    const retainedScroll = await detailsViewport.evaluate((element) => element.scrollTop)
    await standaloneEntry.click()
    await batchEntry.click()
    assert.equal(
      await detailsViewport.evaluate((element) => element.scrollTop),
      retainedScroll,
      "each selected task retains its scroll position",
    )
    await region.getByRole("button", { name: "Close tasks", exact: true }).click()
    await region.waitFor({ state: "hidden" })
    assert.equal(page.url(), destination)
    await page.getByRole("button", { name: /^Tasks/ }).click()
    assert(
      await region.getByText("Original and recovery attempts (2)", { exact: true }).isVisible(),
      "expanded task details survive dismissal",
    )
    await page.screenshot({ path: join(output, `shared-tasks-${viewport.width}.png`) })
  }
  await region.getByRole("button", { name: "Close tasks", exact: true }).click()
  await region.waitFor({ state: "hidden" })
  await page.locator('[data-slot="entity-inspection"]').click()
  await page.keyboard.press("Escape")
  await page.getByRole("grid", { name: "Entities" }).waitFor()
  const final = (await backend.client.GET("/api/v1/import-batches")).data!
  assert.deepEqual(final.batches[0].items[1].attempts[0], originalSnapshot.batches[0].items[1].attempts[0])
  const tasks = (await backend.client.GET("/api/v1/tasks")).data as components["schemas"]["TaskSnapshot"]
  assert.equal(tasks.tasks.length, 6)
  const externalFeedback = await externalTaskBrowser(page, backend, data.library)
  assert.deepEqual(errors, [])
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        tasks,
        batches: final,
        successOutcome,
        warningOutcome,
        listReads,
        errors,
        externalFeedback,
      },
      null,
      2,
    ),
  )
  console.log(
    `PASS shared task discovery, grouping, outcomes, retained task selection/details/late View feedback, focus isolation and minimum viewport. ${output}`,
  )
} finally {
  await browser.close()
  await preview.close()
  await data.dispose()
}
