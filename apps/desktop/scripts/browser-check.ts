import assert from "node:assert/strict"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { chromium } from "playwright"
import { fixture, outputDirectory } from "./fixture.ts"
import { browserPreview } from "./browser-preview.ts"

const data = await fixture()
const backend = await data.start()
const preview = await browserPreview(backend)
const output = await outputDirectory("browser")
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  let preferenceReadsFail = true
  await page.route("**/api/v1/entities/view-preferences/batch", async (route) => {
    if (preferenceReadsFail)
      await route.fulfill({
        status: 500,
        json: { code: "operation_failed", message: "Isolated preference-read failure" },
      })
    else await route.continue()
  })
  await page.goto(`${preview.origin}/#/entity`)
  await page.getByRole("gridcell").first().waitFor()
  const sourceReturn = page.locator("header.title-bar").getByRole("button", { name: "Return to source", exact: true })
  assert(await sourceReturn.isDisabled())
  assert.deepEqual(await page.locator("header.title-bar button").evaluateAll(nodes => nodes.slice(0, 4).map(n => n.getAttribute("aria-label") ?? n.textContent?.trim())), ["Back", "Forward", "Return to source", "Import"])
  const gridUrl = page.url()
  await sourceReturn.evaluate((button: HTMLButtonElement) => button.click())
  assert.equal(page.url(), gridUrl)
  await page.getByRole("link", { name: "Home", exact: true }).click()
  assert(await sourceReturn.isDisabled())
  await page.getByRole("button", { name: "Back", exact: true }).click()
  await page.getByRole("gridcell").first().waitFor()
  await page.getByRole("gridcell").first().dblclick()
  assert(await sourceReturn.isEnabled())
  await page.locator('[data-slot="image-viewport"][data-state="ready"]').waitFor()
  await page.getByRole("button", { name: "Overview", exact: true }).click()
  await page.getByText("Isolated preference-read failure", { exact: true }).waitFor()
  const selected = await page.locator('[data-slot="entity-inspection"]').getAttribute("data-entity-id")
  const observed = await backend.client.GET("/api/v1/entities/{entity_id}/view-preference", {
    params: { path: { entity_id: selected! } },
  })
  assert.equal(observed.data?.status, "unset", "fallback must never save itself")
  await page.screenshot({ path: join(output, "preference-read-failure.png") })
  preferenceReadsFail = false
  await page.getByRole("button", { name: "Retry preference read", exact: true }).click()
  await page.getByText("No saved choice", { exact: true }).waitFor()
  await page.getByRole("button", { name: "Use File view", exact: true }).click()
  await page.getByText("Choice saved", { exact: true }).waitFor()
  await page.getByRole("button", { name: "Next entity", exact: true }).click()
  await page.getByRole("button", { name: "Previous entity", exact: true }).click()
  await page.locator('[data-slot="entity-inspection"][data-view-id="file.info"]').waitFor()
  const result = await backend.client.GET("/api/v1/entities/{entity_id}/view-preference", {
    params: { path: { entity_id: selected! } },
  })
  assert.equal(result.data?.status, "saved")
  if (result.data?.status === "saved") assert.equal(result.data.view_definition_id, "file.info")
  await page.getByRole("button", { name: "Use Image view", exact: true }).click()
  await page.locator('[data-slot="image-viewport"][data-state="ready"]').waitFor()
  await page.getByText("Choice saved", { exact: true }).waitFor()
  await page.screenshot({ path: join(output, "connected-image.png") })
  // Component inspection is separate from choosing (and saving) a main view.
  const inspectionUrl = page.url()
  const mainView = await page.locator('[data-slot="entity-inspection"]').getAttribute("data-view-id")
  await page.getByRole("button", { name: "Open Image details", exact: true }).click()
  const panel = page.locator("#auxiliary-panel")
  assert.equal(await panel.getAttribute("aria-label"), "Image")
  assert.equal(page.url(), inspectionUrl)
  assert.equal(await page.locator('[data-slot="entity-inspection"]').getAttribute("data-view-id"), mainView)
  assert.equal(await panel.getByRole("button", { name: "Copy component id", exact: true }).isVisible(), true)
  await panel.getByText("Revision", { exact: true }).waitFor()
  await page.getByRole("button", { name: "File", exact: true }).click()
  await panel.getByText("Exact size", { exact: true }).waitFor()
  await page.getByRole("button", { name: "Image", exact: true }).click()
  await panel.getByText("Revision", { exact: true }).waitFor()
  assert.equal(
    await panel.getByRole("button", { name: "Copy component id", exact: true }).isVisible(),
    true,
    "all property sections remain available after switching pages",
  )
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  await panel.getByRole("button", { name: "Copy component id", exact: true }).click()
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    data.images.find((image) => image.entityId === selected)!.componentId,
  )
  await page.setViewportSize({ width: 720, height: 480 })
  const detailsSize = await panel
    .locator('[data-slot="scroll-area-viewport"]')
    .evaluate((element) => ({ width: element.clientWidth, content: element.scrollWidth }))
  assert(detailsSize.content <= detailsSize.width + 1, "expanded component details fit the narrow pane")
  await page.screenshot({ path: join(output, "component-details-720.png") })
  await panel.getByRole("button", { name: "Close details panel", exact: true }).click()
  await panel.waitFor({ state: "detached" })
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Image")
  await page.getByRole("button", { name: "Overview", exact: true }).click()
  await page.setViewportSize({ width: 1200, height: 800 })
  // Membership failures preserve the same subject's prior facts and do not
  // convert a failed current observation into a no-components claim.
  let membershipFail = true
  let releaseMembership!: () => void
  let sawMembership!: () => void
  const heldMembership = new Promise<void>((resolve) => {
    releaseMembership = resolve
  })
  const requestedMembership = new Promise<void>((resolve) => {
    sawMembership = resolve
  })
  await page.route("**/api/v1/memberships/read", async (route) => {
    if (!membershipFail) return route.continue()
    sawMembership()
    await heldMembership
    await route.fulfill({
      status: 500,
      json: { code: "operation_failed", message: "Isolated membership failure" },
    })
  })
  await page.getByRole("button", { name: "Reread Entity", exact: true }).first().click()
  await requestedMembership
  await page.getByText("Reading Entity metadata…", { exact: true }).waitFor()
  assert.equal(await page.getByRole("button", { name: "Open Image details", exact: true }).isVisible(), true)
  assert.equal(await page.getByText("No components attached.", { exact: true }).isVisible(), false)
  await page.screenshot({ path: join(output, "overview-loading.png") })
  releaseMembership()
  await page.getByText("Isolated membership failure", { exact: true }).waitFor()
  assert.equal(await page.locator('[data-slot="image-viewport"][data-state="ready"]').count(), 1)
  await page.screenshot({ path: join(output, "retained-metadata.png") })
  membershipFail = false
  await page.getByRole("button", { name: "Reread Entity", exact: true }).first().click()
  await page.getByText("Isolated membership failure", { exact: true }).waitFor({ state: "detached" })
  const unread = await browser.newPage()
  await unread.route("**/api/v1/memberships/read", (route) =>
    route.fulfill({
      status: 500,
      json: { code: "operation_failed", message: "Initial component list unavailable" },
    }),
  )
  await unread.goto(`${preview.origin}/#/entity?entityId=${selected}&mode=grid&collectionId=library`)
  await unread.getByRole("button", { name: "Overview", exact: true }).click()
  await unread.getByText("Initial component list unavailable", { exact: true }).waitFor()
  assert.equal(await unread.getByText("No components attached.", { exact: true }).isVisible(), false)
  assert.equal(await unread.getByText("No content views available.", { exact: true }).isVisible(), false)
  await unread.close()
  // Explicit refresh removal clears selection and returns focus, while an
  // unavailable history retry stays at the requested visit.
  await page.route("**/api/v1/entities", async (route) => {
    if (route.request().method() === "GET")
      await route.fulfill({
        status: 200,
        body: Buffer.alloc(0),
        headers: { "content-type": "application/octet-stream", "content-length": "0" },
      })
    else await route.continue()
  })
  await page.getByRole("button", { name: "Refresh library", exact: true }).click()
  await page
    .getByText("The Entity is no longer in the current list. Selection was cleared.", { exact: true })
    .waitFor()
  assert.equal(await page.locator('[data-slot="entity-inspection"]').count(), 0)
  await page.goto(`${preview.origin}/#/entity?entityId=${selected}&mode=inspect&collectionId=library`)
  await page.getByText("Entity unavailable in this list", { exact: true }).waitFor()
  const historyUrl = page.url()
  await page.getByRole("button", { name: "Retry current list", exact: true }).click()
  await page.getByText("Entity unavailable in this list", { exact: true }).waitFor()
  assert.equal(page.url(), historyUrl)
  assert(await sourceReturn.isEnabled())
  await sourceReturn.click()
  await page.locator('header.title-bar button[aria-label="Return to source"]:disabled').waitFor()
  assert(await sourceReturn.isDisabled())
  // A missing declared source still has a meaningful return action and fallback.
  const missingSource = encodeURIComponent(JSON.stringify({ mode: "grid", collectionId: "removed-gallery" }))
  await page.goto(`${preview.origin}/#/entity?entityId=${selected}&mode=inspect&collectionId=library&source=${missingSource}`)
  await page.getByText("Entity unavailable in this list", { exact: true }).waitFor()
  assert(await sourceReturn.isEnabled())
  await sourceReturn.click()
  await page.locator('header.title-bar button[aria-label="Return to source"]:disabled').waitFor()
  assert(await sourceReturn.isDisabled())
  assert(!page.url().includes("removed-gallery"))
  const initial = await browser.newPage()
  let releaseInitial!: () => void
  const heldInitial = new Promise<void>((done) => {
    releaseInitial = done
  })
  await initial.route("**/api/v1/entities", async (route) => {
    await heldInitial
    await route.fulfill({
      status: 500,
      json: { code: "operation_failed", message: "Isolated initial identity failure" },
    })
  })
  await initial.goto(`${preview.origin}/#/entity?entityId=${selected}&mode=inspect&collectionId=library`)
  await initial.getByText("Reading library…", { exact: true }).waitFor()
  await initial.getByText(`Requested Entity: ${selected} · Context: library`, { exact: true }).waitFor()
  await initial.keyboard.press("Escape")
  assert(initial.url().includes(selected!))
  assert(!initial.url().includes("mode=inspect"))
  releaseInitial()
  await initial.getByText("Unable to read the library", { exact: true }).waitFor()
  assert.equal(
    await initial
      .getByText("The recorded selection is no longer in this list. No replacement was selected.", {
        exact: true,
      })
      .count(),
    0,
  )
  await initial.close()
  assert.deepEqual(errors, [])
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        fixture: data.setup,
        selected,
        preference: result.data,
        screenshots: [
          "preference-read-failure.png",
          "connected-image.png",
          "component-details-720.png",
          "overview-loading.png",
          "retained-metadata.png",
        ],
        errors,
      },
      null,
      2,
    ),
  )
  console.log(
    `PASS isolated real renderer: preference fallback/retry/durable save, navigation retention, resource display, failed reread retention, refresh removal and same-visit history retry. Evidence: ${output}`,
  )
} finally {
  await browser.close()
  await preview.close()
  await data.dispose()
}
