import { waitForContentViewSaved, chooseContentView } from "./content-view-choice.ts"
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
  const checkPageBoundary = async () => {
    const geometry = await page.locator('section[aria-label="Entity"]').evaluate(element => {
      const page = element.getBoundingClientRect()
      const lines = [...element.querySelectorAll(':scope > [data-boundary="page"]')].map(line => {
        const box = line.getBoundingClientRect(); return { x: box.x, width: box.width, height: box.height }
      })
      const tags = element.querySelector('[aria-label="Personal tag summary"]')
      return { x: page.x, width: page.width, lines, tagsBorder: tags ? getComputedStyle(tags).borderBottomWidth : undefined }
    })
    assert.deepEqual(geometry.lines, [{ x: geometry.x, width: geometry.width, height: 1 }], "Grid and inspection share one full page boundary")
    if (geometry.tagsBorder) assert.equal(geometry.tagsBorder, "0px", "The tag summary does not add a shorter header boundary")
  }
  await checkPageBoundary()
  const footerTargets = await page.getByRole("contentinfo", { name: "Application footer", exact: true }).locator("button").evaluateAll(buttons =>
    buttons.filter(button => !button.textContent?.trim()).map(button => {
      const target = button.getBoundingClientRect(), icon = button.querySelector("svg")!.getBoundingClientRect()
      return { width: target.width, height: target.height, iconWidth: icon.width, iconHeight: icon.height }
    }))
  assert(footerTargets.length > 0)
  assert(footerTargets.every(target => target.width === 24 && target.height === 24 && target.iconWidth === 12 && target.iconHeight === 12), JSON.stringify(footerTargets))
  const sourceReturn = page
    .locator("header.title-bar")
    .getByRole("button", { name: "Return to source", exact: true })
  assert(await sourceReturn.isDisabled())
  assert.deepEqual(
    await page
      .locator("header.title-bar button")
      .evaluateAll((nodes) =>
        nodes.slice(0, 4).map((n) => n.getAttribute("aria-label") ?? n.textContent?.trim()),
      ),
    ["Back", "Forward", "Return to source", "Import"],
  )
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
  await checkPageBoundary()
  await page.getByRole("button", { name: "Overview", exact: true }).click()
  await page.getByText("Isolated preference-read failure", { exact: true }).waitFor()
  const selected = await page.locator('[data-slot="entity-inspection"]').getAttribute("data-entity-id")
  const observed = await backend.client.GET("/api/v1/entities/{entity_id}/view-preference", {
    params: { path: { entity_id: selected! } },
  })
  assert.equal(observed.data?.status, "unset", "fallback must never save itself")
  await page.getByRole("region", { name: "Entity problems", exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(output, "preference-read-failure.png") })
  await page.setViewportSize({ width: 720, height: 480 })
  const problems = page.getByRole("region", { name: "Entity problems", exact: true })
  assert(await problems.evaluate(element => element.scrollWidth <= element.clientWidth))
  await problems.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(output, "problems-narrow.png") })
  await page.setViewportSize({ width: 1200, height: 800 })
  preferenceReadsFail = false
  await page.getByRole("button", { name: "Retry preference read", exact: true }).click()
  await page.getByText("No saved choice", { exact: true }).waitFor()
  await page.getByRole("combobox", { name: "Default view", exact: true }).click()
  await page.getByRole("option", { name: "Use Image view", exact: true }).waitFor()
  await page.keyboard.press("ArrowRight")
  assert.equal(await page.locator('[data-slot="entity-inspection"]').getAttribute("data-entity-id"), selected)
  await page.keyboard.press("Escape")
  await page.getByRole("listbox").waitFor({ state: "hidden" })
  assert.equal(await page.locator('[data-slot="entity-inspection"]').getAttribute("data-entity-id"), selected)
  await chooseContentView(page, "Image")
  await waitForContentViewSaved(page)
  await chooseContentView(page, "File")
  await waitForContentViewSaved(page)
  assert.equal(await page.getByText("Saved", { exact: true }).count(), 0)
  await page.getByRole("button", { name: "Next entity", exact: true }).click()
  await page.getByRole("button", { name: "Previous entity", exact: true }).click()
  await page.locator('[data-slot="entity-inspection"][data-view-id="file.info"]').waitFor()
  const result = await backend.client.GET("/api/v1/entities/{entity_id}/view-preference", {
    params: { path: { entity_id: selected! } },
  })
  assert.equal(result.data?.status, "saved")
  if (result.data?.status === "saved") assert.equal(result.data.view_definition_id, "file.info")
  await sourceReturn.click()
  const chosenCard = page.locator(`[role="gridcell"][id$="-${selected}"]`)
  await chosenCard.locator('[data-slot="entity-card-component"][data-component="file"]').waitFor()
  await chooseContentView(page, "Image")
  await chosenCard.locator('[data-slot="entity-card-component"][data-component="image"]').waitFor()
  await chosenCard.dblclick()

  await chooseContentView(page, "Image")
  await page.locator('[data-slot="image-viewport"][data-state="ready"]').waitFor()
  await waitForContentViewSaved(page)
  await page.screenshot({ path: join(output, "connected-image.png") })
  // Component inspection is separate from choosing (and saving) a main view.
  const inspectionUrl = page.url()
  const mainView = await page.locator('[data-slot="entity-inspection"]').getAttribute("data-view-id")
  await page.getByRole("button", { name: "Open Image details", exact: true }).click()
  const panel = page.locator("#auxiliary-panel")
  assert.equal(await panel.getAttribute("aria-label"), "Image")
  assert.equal(page.url(), inspectionUrl)
  assert.equal(await page.locator('[data-slot="entity-inspection"]').getAttribute("data-view-id"), mainView)
  assert.equal(await panel.getByRole("button", { name: "Component ID", exact: true }).count(), 0)
  assert.equal(await panel.getByRole("button", { name: "Copy component id", exact: true }).count(), 0)
  const componentId = data.images.find(image => image.entityId === selected)!.componentId
  const identity = panel.getByText(componentId, { exact: true })
  assert(await identity.isVisible())
  await panel.getByText("Revision", { exact: true }).waitFor()
  await page.getByRole("button", { name: "File", exact: true }).click()
  await panel.getByText("Size", { exact: true }).waitFor()
  assert.equal(await panel.getByText("Exact size", { exact: true }).count(), 0, "formatted and exact size share one property row")
  await page.getByRole("button", { name: "Image", exact: true }).click()
  await panel.getByText("Revision", { exact: true }).waitFor()
  assert(await identity.isVisible(), "all property sections remain available after switching pages")
  assert.equal(await identity.evaluate(element => getComputedStyle(element).userSelect), "text")
  const identityBox = await identity.boundingBox()
  assert(identityBox)
  await page.mouse.move(identityBox.x + 1, identityBox.y + identityBox.height / 4)
  await page.mouse.down()
  await page.mouse.move(identityBox.x + 55, identityBox.y + identityBox.height / 4, { steps: 8 })
  await page.mouse.up()
  const selectedIdentity = await page.evaluate(() => window.getSelection()?.toString())
  assert(selectedIdentity && componentId.includes(selectedIdentity), selectedIdentity)
  await page.setViewportSize({ width: 720, height: 480 })
  const detailsSize = await panel
    .locator('[data-slot="scroll-area-viewport"]')
    .evaluate((element) => ({ width: element.clientWidth, content: element.scrollWidth }))
  assert(detailsSize.content <= detailsSize.width + 1, "expanded component details fit the narrow pane")
  await page.screenshot({ path: join(output, "component-details-720.png") })
  await page.getByRole("button", { name: "Image", exact: true }).click()
  await panel.waitFor({ state: "detached" })
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Image")
  // Names remain available to keyboard users, and clipped rail items can be
  // reached without opening another panel or losing the browsing context.
  await page.setViewportSize({ width: 720, height: 240 })
  const navigation = page.getByRole("complementary", { name: "Auxiliary panels", exact: true })
  const railViewport = navigation.locator('[data-slot="scroll-area-viewport"]')
  await navigation.getByRole("button", { name: "Overview", exact: true }).focus()
  await page.keyboard.press("Tab")
  await page.keyboard.press("Tab")
  const imageTrigger = navigation.getByRole("button", { name: "Image", exact: true })
  assert(await imageTrigger.evaluate(element => element === document.activeElement))
  const railState = await railViewport.evaluate(element => ({
    scroll: element.scrollTop, height: element.clientHeight, content: element.scrollHeight,
  }))
  assert(railState.content > railState.height && railState.scroll > 0, "keyboard focus reveals overflowing panel buttons")
  await imageTrigger.press("Enter")
  await panel.waitFor()
  await page.getByRole("button", { name: "Image", exact: true }).click()
  assert(await imageTrigger.evaluate(element => element === document.activeElement))
  await page.screenshot({ path: join(output, "panel-rail-short.png"), animations: "disabled" })
  await page.setViewportSize({ width: 720, height: 480 })
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
  await page.goto(
    `${preview.origin}/#/entity?entityId=${selected}&mode=inspect&collectionId=library&source=${missingSource}`,
  )
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
  await initial.locator('[data-slot="entity-workspace"]').getByText("Reading library…", { exact: true }).waitFor()
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
  // A failed refresh retains the complete grid and offers recovery beside its error.
  const recovery = await browser.newPage({ viewport: { width: 720, height: 480 } })
  recovery.on("pageerror", error => errors.push(error.message))
  await recovery.goto(`${preview.origin}/#/entity?mode=grid&collectionId=library`)
  await recovery.getByRole("gridcell").first().waitFor()
  const previousCount = await recovery.getByRole("gridcell").count()
  await recovery.route("**/api/v1/entities", route => route.fulfill({ status: 500,
    json: { code: "operation_failed", message: "Isolated library refresh failure" } }))
  await recovery.getByRole("button", { name: "Refresh library", exact: true }).click()
  const refreshFailure = recovery.getByRole("alert").filter({ hasText: "Library refresh failed" })
  await refreshFailure.waitFor()
  assert.equal(await recovery.getByRole("gridcell").count(), previousCount)
  assert(await refreshFailure.evaluate(element => element.scrollWidth <= element.clientWidth))
  await recovery.screenshot({ path: join(output, "library-refresh-failure.png") })
  await recovery.unroute("**/api/v1/entities")
  await refreshFailure.getByRole("button", { name: "Retry library read", exact: true }).press("Enter")
  await refreshFailure.waitFor({ state: "hidden" })
  assert.equal(await recovery.getByRole("gridcell").count(), previousCount)
  await recovery.route("**/api/v1/entities", route => route.fulfill({ status: 200, body: Buffer.alloc(0),
    headers: { "content-type": "application/octet-stream", "content-length": "0" } }))
  await recovery.getByRole("button", { name: "Refresh library", exact: true }).click()
  await recovery.getByText("No entities yet.", { exact: true }).waitFor()
  assert(await recovery.getByRole("button", { name: "Import", exact: true }).isEnabled())
  await recovery.screenshot({ path: join(output, "library-empty.png") })
  await recovery.close()
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
          "problems-narrow.png",
          "library-refresh-failure.png",
          "library-empty.png",
          "connected-image.png",
          "component-details-720.png",
          "panel-rail-short.png",
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
