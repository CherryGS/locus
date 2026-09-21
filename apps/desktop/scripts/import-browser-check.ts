import assert from "node:assert/strict"
import { join } from "node:path"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { chromium } from "playwright"
import { fixture, outputDirectory } from "./fixture.ts"
import { browserPreview } from "./browser-preview.ts"
import { fixturePng } from "../../../packages/locus-client/smoke-png.ts"
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
  await page.getByRole("gridcell").first().dblclick()
  await page.locator('[data-slot="entity-inspection"]').waitFor()
  const destination = page.url(),
    initialLists = lists
  await page.getByRole("button", { name: "Import", exact: true }).click()
  await page.getByText("No imports yet", { exact: true }).waitFor()
  assert.equal(submissions, 0)
  await page.keyboard.press("Escape")
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
  await page.getByText("Submission unconfirmed", { exact: true }).waitFor()
  const beforeRecovery = await backend.client.GET("/api/v1/import-batches")
  assert.equal(
    beforeRecovery.data?.batches.length,
    0,
    "Lost delivery must not create an import before explicit recovery",
  )
  assert.equal(submissions, 1)
  await page.getByRole("button", { name: "Check original submission", exact: true }).click()
  await page.getByText("2 complete", { exact: true }).waitFor()
  assert.equal(redeliveredBody, lostBody, "Explicit recovery redelivers the same full body and request identity")
  await page.unroute("**/api/v1/import-batches")
  await page.getByText("1 need attention", { exact: true }).waitFor()
  assert.equal(page.url(), destination)
  assert.equal(lists, initialLists)
  assert.equal(submissions, 2)
  const plainRow = page.locator("article").filter({ hasText: plain })
  await page.route("**/api/v1/entities", (route) =>
    route.fulfill({ status: 500, json: { code: "operation_failed", message: "test refresh unavailable" } }),
  )
  await plainRow.getByRole("button", { name: "View", exact: true }).click()
  await page
    .getByText("Library refresh failed. The prior list and selection are preserved.", { exact: true })
    .waitFor()
  assert.equal(page.url(), destination)
  await page.unroute("**/api/v1/entities")
  let releaseRefresh!: () => void
  let sawRefresh!: () => void
  const heldRefresh = new Promise<void>((resolve) => {
    releaseRefresh = resolve
  })
  const requestedRefresh = new Promise<void>((resolve) => {
    sawRefresh = resolve
  })
  await page.route("**/api/v1/entities", async (route) => {
    sawRefresh()
    await heldRefresh
    await route.continue()
  })
  await plainRow.getByRole("button", { name: "View", exact: true }).click()
  await requestedRefresh
  await page.keyboard.press("Escape")
  await page.locator('[data-slot="dialog-content"]').waitFor({ state: "detached" })
  await page.getByRole("button", { name: "Next entity", exact: true }).click()
  const newerDestination = page.url()
  releaseRefresh()
  await page.getByRole("button", { name: "Imports", exact: true }).click()
  await page.getByText("Viewing was superseded by newer navigation.", { exact: true }).waitFor()
  assert.equal(page.url(), newerDestination)
  await page.unroute("**/api/v1/entities")
  await writeFile(missing, "now explicitly recopy")
  await page
    .locator("article")
    .filter({ hasText: missing })
    .getByRole("button", { name: "Recopy source and import", exact: true })
    .click()
  await page.getByText("3 complete", { exact: true }).waitFor()
  await page
    .locator("article")
    .filter({ hasText: missing })
    .getByText("Original and recovery attempts (2)", { exact: true })
    .click()
  const viewport = page.locator('[data-slot="dialog-content"] [data-slot="scroll-area-viewport"]')
  const scroll = await viewport.evaluate((e) => ({
    height: e.clientHeight,
    content: e.scrollHeight,
    bottom: e.getBoundingClientRect().bottom,
  }))
  assert(scroll.content > scroll.height && scroll.bottom <= 800, "Expanded attempts must scroll inside the dialog")
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
  await page.locator(`[data-slot="entity-inspection"][data-entity-id="${imported.current.entity_id}"]`).waitFor()
  await page.locator('[data-slot="image-viewport"][data-state="ready"]').waitFor()
  assert.equal(
    await page.locator('[data-slot="entity-inspection"]').getAttribute("data-entity-id"),
    imported.current.entity_id,
  )
  await page.locator('[data-slot="dialog-content"]').waitFor({ state: "detached" })
  await page.keyboard.press("Escape")
  await page.getByRole("grid", { name: "Entities" }).waitFor()
  await page.getByRole("button", { name: "Imports complete", exact: true }).waitFor()
  assert.equal(await page.getByRole("button", { name: "Imports: 1 need attention", exact: true }).count(), 0)
  await page.screenshot({ path: join(output, "imported-library.png") })
  assert.equal((await page.locator('img[src^="blob:"]').count()) > 0, true)
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
