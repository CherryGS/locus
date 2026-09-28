import assert from "node:assert/strict"
import { join } from "node:path"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { chromium } from "playwright"
import { fixture, outputDirectory } from "./fixture.ts"
import { browserPreview } from "./browser-preview.ts"
import { fixturePng } from "../../../packages/locus-client/smoke-png.ts"
import { registeredImportBrowser } from "./registered-import-browser.ts"
const data = await fixture(),
  backend = await data.start(),
  preview = await browserPreview(backend)
const output = await outputDirectory("import-browser"),
  sources = await mkdtemp(join(tmpdir(), "locus-import-browser-"))
const plain = join(sources, "ordinary.txt"),
  image = join(sources, "image.wrong"),
  missing = join(sources, "missing.txt")
await writeFile(plain, "ordinary")
await writeFile(image, fixturePng(64, 32))
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  await page.route("**/__desktop-preview.js", async (route) => {
    const response = await route.fetch()
    const script = await response.text()
    await route.fulfill({
      response,
      body: script.replace(
        'selectImportFiles:async()=>({status:"canceled"})',
        'selectImportFiles:async()=>globalThis.__importSelections.shift()??({status:"canceled"})',
      ),
    })
  })
  await page.addInitScript(() => {
    ;(globalThis as any).__importSelections = []
  })
  let lists = 0,
    submissions = 0
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/v1/entities" && r.method() === "GET") lists++
    if (new URL(r.url()).pathname === "/api/v1/import-batches" && r.method() === "POST") submissions++
  })
  await page.goto(`${preview.origin}/#/entity`)
  const initialCount = await page.locator("[data-entity-count]").getAttribute("data-entity-count")
  await page.getByRole("gridcell").first().dblclick()
  await page.locator('[data-slot="entity-inspection"]').waitFor()
  const destination = page.url(),
    initialLists = lists
  await page.getByRole("button", { name: "Import", exact: true }).click()
  assert.equal(await page.getByRole("dialog", { name: "Tasks this run" }).isVisible(), false)
  assert.equal(submissions, 0)
  await page.evaluate(
    (paths) => {
      ;(globalThis as any).__importSelections.push({ status: "selected", paths })
    },
    [plain, image, missing],
  )
  let lostBody: string | null = null
  let redeliveredBody: string | null = null
  await page.route("**/api/v1/import-batches", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue()
      return
    }
    if (lostBody === null) {
      lostBody = route.request().postData()
      await route.abort("failed")
      return
    }
    redeliveredBody = route.request().postData()
    await route.continue()
  })
  await page.getByRole("button", { name: "Import", exact: true }).click()
  assert.equal(await page.getByRole("dialog", { name: "Tasks this run" }).isVisible(), false)
  await page.getByRole("button", { name: /^Tasks/ }).click()
  await page.locator("[data-task-record]").click()
  await page
    .locator('[data-task-detail]:visible [data-slot="alert-title"]')
    .filter({ hasText: "Submission unconfirmed" })
    .waitFor()
  const beforeRecovery = await backend.client.GET("/api/v1/import-batches")
  assert.equal(
    beforeRecovery.data?.batches.length,
    0,
    "Lost delivery must not create an import before explicit recovery",
  )
  assert.equal(submissions, 1)
  await page.getByRole("button", { name: "Check original submission", exact: true }).click()
  await page.locator("[data-task-record]").filter({ hasText: "2 complete" }).waitFor()
  assert.equal(
    redeliveredBody,
    lostBody,
    "Explicit recovery redelivers the same full body and request identity",
  )
  await page.unroute("**/api/v1/import-batches")
  await page.locator("[data-task-record]").filter({ hasText: "1 need attention" }).waitFor()
  assert.equal(page.url(), destination)
  assert.equal(lists, initialLists)
  assert.equal(submissions, 2)
  const plainRow = page.locator("article").filter({ hasText: plain })
  await page.route("**/api/v1/memberships/read", (route) =>
    route.fulfill({ status: 500, json: { code: "operation_failed", message: "test refresh unavailable" } }),
  )
  await plainRow.getByRole("button", { name: "View", exact: true }).click()
  await page.getByText(/Unable to observe imported Entity .*test refresh unavailable/).waitFor()
  assert.equal(page.url(), destination)
  await page.unroute("**/api/v1/memberships/read")
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
    await route.continue()
  })
  await plainRow.getByRole("button", { name: "View", exact: true }).click()
  await requestedRefresh
  await page.keyboard.press("Escape")
  await page.getByRole("dialog", { name: "Tasks this run" }).waitFor({ state: "hidden" })
  await page.getByRole("button", { name: "Next entity", exact: true }).click()
  const newerDestination = page.url()
  releaseRefresh()
  await page
    .locator('[data-slot="dialog-content"][hidden]')
    .filter({ hasText: "Viewing was superseded by newer navigation." })
    .waitFor({ state: "attached" })
  assert.equal(await page.getByRole("dialog", { name: "Tasks this run" }).isVisible(), false)
  await page.getByRole("button", { name: /^Tasks/ }).click()
  await page.getByText("Viewing was superseded by newer navigation.", { exact: true }).waitFor()
  assert.equal(page.url(), newerDestination)
  await page.unroute("**/api/v1/memberships/read")
  await writeFile(missing, "now explicitly recopy")
  await page
    .locator("article")
    .filter({ hasText: missing })
    .getByRole("button", { name: "Recopy source and import", exact: true })
    .click()
  await page.locator("[data-task-record]").filter({ hasText: "3 complete" }).waitFor()
  await page.locator("article").filter({ hasText: missing }).getByText("Details", { exact: true }).click()
  await page
    .locator("article")
    .filter({ hasText: missing })
    .getByText("Original and recovery attempts (2)", { exact: true })
    .click()
  const viewport = page
    .getByRole("dialog", { name: "Tasks this run" })
    .getByLabel("Task details", { exact: true })
  const scroll = await viewport.evaluate((e) => ({
    height: e.clientHeight,
    content: e.scrollHeight,
    bottom: e.getBoundingClientRect().bottom,
  }))
  assert(
    scroll.content > scroll.height && scroll.bottom <= 800,
    "Expanded attempts must scroll inside the task modal",
  )
  await page.screenshot({ path: join(output, "imports-recovery.png") })
  await page
    .locator("article")
    .filter({ hasText: image })
    .getByRole("button", { name: "View", exact: true })
    .click()
  await page.locator('[data-slot="image-viewport"][data-state="ready"]').waitFor()
  const snapshot = await backend.client.GET("/api/v1/import-batches")
  assert(snapshot.data)
  const imported = snapshot.data.batches[0].items.find((i) => i.source_path === image)!
  await page
    .locator(`[data-slot="entity-inspection"][data-entity-id="${imported.current.entity_id}"]`)
    .waitFor()
  await page.locator('[data-slot="image-viewport"][data-state="ready"]').waitFor()
  assert.equal(
    await page.locator('[data-slot="entity-inspection"]').getAttribute("data-entity-id"),
    imported.current.entity_id,
  )
  await page.getByRole("dialog", { name: "Tasks this run" }).waitFor({ state: "hidden" })
  await page.locator('[data-slot="entity-inspection"]').click()
  await page.keyboard.press("Escape")
  await page.getByRole("grid", { name: "Entities" }).waitFor()
  await page.getByRole("button", { name: /^Tasks.*1 records$/ }).waitFor()
  assert.equal(await page.getByRole("button", { name: /Tasks.*need attention/ }).count(), 0)
  await page.screenshot({ path: join(output, "imported-library.png") })
  assert.equal(lists, initialLists, "Task View does not enumerate or replace the main result")
  assert.equal(await page.locator("[data-entity-count]").getAttribute("data-entity-count"), initialCount)
  assert.equal(await page.locator(`[role="gridcell"][id$="-${imported.current.entity_id}"]`).count(), 0)
  assert(
    await page
      .getByRole("grid", { name: "Entities" })
      .evaluate((element) => element === document.activeElement),
    "Direct return restores keyboard focus without selecting its temporary target",
  )
  assert.deepEqual(errors, [])
  await registeredImportBrowser(page, backend, data.library, sources, output)
  assert.deepEqual(errors, [])
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        sources,
        lists,
        submissions,
        snapshot: snapshot.data,
        errors,
        picker: "injected browser selection; not an OS picker test",
      },
      null,
      2,
    ),
  )
  console.log(
    `PASS import browser cancellation, mixed results, no completion navigation/list refresh, failed View retention, explicit recopy, exact-Entity View and attributed thumbnails. ${output}`,
  )
} finally {
  await browser.close()
  await preview.close()
  await data.dispose()
}
