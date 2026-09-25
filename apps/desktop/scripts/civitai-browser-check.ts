import assert from "node:assert/strict"
import { join } from "node:path"
import { chromium } from "playwright"
import { civitaiFixture } from "./civitai-fixture.ts"
import { browserPreview } from "./browser-preview.ts"
import { outputDirectory } from "./fixture.ts"
const data = await civitaiFixture(),
  backend = await data.start(),
  preview = await browserPreview(backend)
const output = await outputDirectory("civitai-browser"),
  browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } }),
    errors: string[] = [],
    unadmitted: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  page.on("request", (r) => {
    if (r.url().includes("invalid.example")) unadmitted.push(r.url())
  })
  const a = data.entries.find((e) => e.name === "A")!,
    b = data.entries.find((e) => e.name === "B")!,
    c = data.entries.find((e) => e.name === "C")!
  await page.goto(`${preview.origin}/#/entity`)
  const existing = data.entries.find((e) => e.name === "existing")!
  await page.locator(`[role="gridcell"][id$="-${existing.entityId}"]`).dblclick()
  await page.getByRole("button", { name: "Overview", exact: true }).click()
  await page.getByRole("button", { name: "Use File view", exact: true }).click()
  await page.getByText("Choice saved", { exact: true }).waitFor()
  assert.equal(await page.getByRole("button", { name: "Use Civitai view", exact: true }).count(), 0)
  await data.phase("existing")
  await page.getByRole("button", { name: "Enrich this File with Civitai", exact: true }).click()
  await page.getByRole("button", { name: "Use Civitai view", exact: true }).waitFor()
  assert.equal(await page.locator('[data-slot="entity-inspection"][data-view-id="file.info"]').count(), 1)
  const preference = await backend.client.GET("/api/v1/entities/{entity_id}/view-preference", {
    params: { path: { entity_id: existing.entityId } },
  })
  assert(preference.data?.status === "saved" && preference.data.view_definition_id === "file.info")
  await page.getByRole("button", { name: "Use Civitai view", exact: true }).click()
  await page
    .locator('[data-slot="civitai-page"]')
    .getByText("existing independent model description", { exact: true })
    .waitFor()
  await page.screenshot({ path: join(output, "existing-entry-first-enrichment.png") })
  await page.getByRole("button", { name: "Return to source", exact: true }).first().click()
  await data.phase("A")
  await page.locator(`[role="gridcell"][id$="-${a.entityId}"]`).dblclick()
  if (!(await page.locator('#auxiliary-panel[aria-label="Overview"]').count()))
    await page.getByRole("button", { name: "Overview", exact: true }).click()
  await page.getByRole("button", { name: "Use Civitai view", exact: true }).click()
  const reading = page.locator('[data-slot="civitai-page"]')
  const civitaiPanel = page.locator('#auxiliary-panel[aria-label="Civitai"]')
  async function openReadingDetails() {
    await reading.getByRole("button", { name: "Open Civitai details", exact: true }).click()
    await civitaiPanel.locator('[data-slot="civitai-reading-details"]').waitFor()
  }
  async function versionDescription(text: string) {
    const description = reading.getByText(text, { exact: true })
    await description.waitFor({ state: "attached" })
    const notes = reading.locator('[data-slot="civitai-version-notes"]')
    if ((await notes.getAttribute("open")) === null) await notes.locator("summary").click()
    await description.waitFor()
  }
  await reading.getByText("A independent model description", { exact: true }).waitFor()
  assert.equal(await reading.getByText("Version 40", { exact: false }).count(), 0)
  await reading
    .getByRole("button", { name: "Version 30 · not recorded in this snapshot", exact: true })
    .click()
  await reading.getByRole("button", { name: `Source Entity ${b.entityId.slice(-8)}`, exact: true }).click()
  await versionDescription("B version description")
  assert(await reading.getByText("A independent model description", { exact: true }).isVisible())
  assert.equal(
    await page.locator(`[data-slot="entity-inspection"][data-entity-id="${a.entityId}"]`).count(),
    1,
  )
  await openReadingDetails()
  await civitaiPanel.getByRole("button", { name: "B.safetensors · 300", exact: true }).click()
  // A delayed source switch must retain the old presentation without allowing
  // its actions to target the newly selected source.
  const stage = reading.locator('[data-slot="civitai-gallery-stage"]')
  await stage.locator("img").waitFor()
  const stageLayout = () =>
    stage.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const viewport = element.closest('[data-slot="scroll-area-viewport"]')!
      return { x: bounds.x, y: bounds.y + viewport.scrollTop, width: bounds.width, height: bounds.height }
    })
  const stageBefore = await stageLayout()
  const previousPreview = await stage.locator("img").getAttribute("src")
  let releaseSwitch!: () => void, switchRequested!: () => void
  const heldSwitch = new Promise<void>((resolve) => {
    releaseSwitch = resolve
  })
  const requestedSwitch = new Promise<void>((resolve) => {
    switchRequested = resolve
  })
  await page.route(`**/civitai/${a.componentId}/version?*`, async (route) => {
    if (new URL(route.request().url()).searchParams.get("source") === c.componentId) {
      switchRequested()
      await heldSwitch
    }
    await route.continue()
  })
  await reading.getByRole("button", { name: `Source Entity ${c.entityId.slice(-8)}`, exact: true }).click()
  await requestedSwitch
  assert.deepEqual(await stageLayout(), stageBefore, "loading must not collapse or move the gallery")
  assert.equal(await stage.locator("img").getAttribute("src"), previousPreview)
  assert.match(
    await reading.locator('[data-slot="civitai-version-status"]').innerText(),
    /Loading version.*Showing/,
  )
  assert.equal(
    await reading.getByRole("button", { name: "Inspect managed example", exact: true }).isEnabled(),
    false,
  )
  assert.equal(
    await civitaiPanel.getByRole("button", { name: "B.safetensors · 300", exact: true }).isEnabled(),
    false,
  )
  releaseSwitch()
  await versionDescription("C version description")
  await page.unroute(`**/civitai/${a.componentId}/version?*`)
  await reading.getByText("Focused file coverage", { exact: true }).waitFor()
  await reading
    .getByText("Previous version observation · rereading selected source.", { exact: true })
    .waitFor({ state: "hidden" })
  assert.equal(await reading.getByText(/Previous version observation/).count(), 0)
  assert.equal(await civitaiPanel.locator("summary").filter({ hasText: "provider declarations" }).count(), 0)
  const originSnapshot = civitaiPanel.getByRole("region", { name: "Origin Civitai snapshot" })
  assert.equal(await originSnapshot.getByText(a.componentId!, { exact: true }).count(), 1)
  const originRead = await backend.client.GET("/api/v1/civitai/{component_id}/view", {
    params: { path: { component_id: a.componentId! } },
  })
  assert(originRead.data)
  assert.equal(
    await originSnapshot.getByText(originRead.data.record.matched_version, { exact: true }).count(),
    1,
    "reading a peer version must retain the origin correspondence",
  )
  await page.route(`**/civitai/${a.componentId}/version?*`, (route) =>
    route.fulfill({
      status: 500,
      json: { code: "operation_failed", message: "Controlled selected-source read failure" },
    }),
  )
  await reading.getByRole("button", { name: "Reread saved information", exact: true }).click()
  await reading
    .getByText("Previous version observation · the latest source read failed.", { exact: true })
    .waitFor()
  assert(await reading.getByText("C version description", { exact: true }).isVisible())
  await page.unroute(`**/civitai/${a.componentId}/version?*`)
  await reading.getByRole("button", { name: "Retry saved version read", exact: true }).click()
  await reading
    .getByText("Previous version observation · the latest source read failed.", { exact: true })
    .waitFor({ state: "hidden" })
  await reading.getByRole("button", { name: `Source Entity ${b.entityId.slice(-8)}`, exact: true }).click()
  await versionDescription("B version description")
  let releaseOpen!: () => void, markRequested!: () => void
  const heldOpen = new Promise<void>((resolve) => {
    releaseOpen = resolve
  })
  const requestedOpen = new Promise<void>((resolve) => {
    markRequested = resolve
  })
  let holdNext = true
  await page.route(`**/civitai/${a.componentId}/version?*`, async (route) => {
    if (holdNext) {
      holdNext = false
      markRequested()
      await heldOpen
    }
    await route.continue()
  })
  await reading.getByRole("button", { name: "Inspect managed example", exact: true }).first().click()
  await requestedOpen
  await reading.getByRole("button", { name: /Version 20$/ }).click()
  await reading
    .getByRole("button", { name: "Version 30 · not recorded in this snapshot", exact: true })
    .click()
  await reading.getByRole("button", { name: `Source Entity ${b.entityId.slice(-8)}`, exact: true }).click()
  await versionDescription("B version description")
  assert(
    await reading.getByRole("button", { name: "Inspect managed example", exact: true }).first().isEnabled(),
  )
  const staleOpenCompleted = page.waitForResponse((response) =>
    response.url().includes(`/civitai/${a.componentId}/version?`),
  )
  releaseOpen()
  await staleOpenCompleted
  await page.unroute(`**/civitai/${a.componentId}/version?*`)
  assert.equal(
    await page.locator(`[data-slot="entity-inspection"][data-entity-id="${a.entityId}"]`).count(),
    1,
  )
  await civitaiPanel.getByRole("button", { name: "B.safetensors · 300", exact: true }).click()
  await page.screenshot({ path: join(output, "origin-with-peer-version.png") })
  await reading.getByRole("button", { name: "Inspect managed example", exact: true }).first().click()
  await page.locator('[data-slot="entity-inspection"][data-view-id="image.inspect"]').waitFor()
  await page.getByRole("link", { name: "Setting", exact: true }).click()
  await page.getByRole("button", { name: "Back", exact: true }).click()
  await page.locator('[data-slot="entity-inspection"][data-view-id="image.inspect"]').waitFor()
  await page.getByRole("button", { name: "Return to source", exact: true }).first().click()
  await versionDescription("B version description")
  await openReadingDetails()
  await civitaiPanel
    .getByText("B.safetensors · Model · provider declarations", { exact: true })
    .waitFor({ state: "attached" })
  if (!(await page.getByRole("button", { name: "Use File view", exact: true }).count()))
    await page.getByRole("button", { name: "Overview", exact: true }).click()
  await page.getByRole("button", { name: "Use File view", exact: true }).click()
  await page.getByRole("button", { name: "Use Civitai view", exact: true }).click()
  await versionDescription("A version description")
  await page.route(`**/civitai/${a.componentId}/page`, (route) =>
    route.fulfill({
      status: 500,
      json: { code: "operation_failed", message: "Controlled page read failure" },
    }),
  )
  await reading.getByRole("button", { name: "Reread saved information", exact: true }).click()
  await reading.getByText(/Controlled page read failure/).waitFor()
  assert(await reading.getByText("A independent model description", { exact: true }).isVisible())
  await page.unroute(`**/civitai/${a.componentId}/page`)
  await reading.getByRole("button", { name: "Reread saved information", exact: true }).click()
  await reading.getByText(/Controlled page read failure/).waitFor({ state: "hidden" })
  await data.phase("A")
  await openReadingDetails()
  await civitaiPanel.locator('[data-slot="civitai-maintenance"] > summary').click()
  await civitaiPanel.getByRole("button", { name: "Refresh origin Civitai information", exact: true }).click()
  await civitaiPanel.getByText("Origin operation · complete", { exact: true }).waitFor()
  const view = await backend.client.GET("/api/v1/civitai/{component_id}/view", {
    params: { path: { component_id: a.componentId! } },
  })
  assert.equal(view.data?.host, a.entityId)
  assert.equal(view.data?.record.revision, "1")
  await page.screenshot({ path: join(output, "refreshed-origin.png") })
  assert.deepEqual(unadmitted, [])
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ result: "passed", output, entities: data.entries }))
} finally {
  await browser.close()
  await preview.close()
  await data.dispose()
}
