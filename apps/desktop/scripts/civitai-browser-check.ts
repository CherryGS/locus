import { waitForContentViewSaved, chooseContentView, hasContentView } from "./content-view-choice.ts"
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
  await chooseContentView(page, "File")
  await waitForContentViewSaved(page)
  assert.equal(await hasContentView(page, "Civitai"), false)
  await data.phase("existing")
  await page.getByRole("button", { name: "Enrich this File with Civitai", exact: true }).click()
  await page.getByRole("combobox", { name: "Default view", exact: true }).click()
  await page.getByRole("option", { name: "Use Civitai view", exact: true }).waitFor()
  await page.keyboard.press("Escape")
  assert.equal(await page.locator('[data-slot="entity-inspection"][data-view-id="file.info"]').count(), 1)
  const preference = await backend.client.GET("/api/v1/entities/{entity_id}/view-preference", {
    params: { path: { entity_id: existing.entityId } },
  })
  assert(preference.data?.status === "saved" && preference.data.view_definition_id === "file.info")
  await chooseContentView(page, "Civitai")
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
  await chooseContentView(page, "Civitai")
  const reading = page.locator('[data-slot="civitai-page"]')
  const civitaiPanel = page.locator('#auxiliary-panel[aria-label="Civitai"]')
  async function versionDescription(text: string) {
    await reading
      .getByRole("region", { name: "Version notes", exact: true })
      .getByText(text, { exact: true })
      .waitFor()
  }
  await reading.getByText("A independent model description", { exact: true }).waitFor()
  assert(await reading.getByRole("list", { name: "Model tags", exact: true }).isVisible())
  assert.equal(await reading.getByRole("region", { name: "Current local file", exact: true }).count(), 0)
  assert(await reading.getByRole("region", { name: "Version files" }).getByText("A.safetensors", { exact: true }).isVisible())
  assert.equal(await reading.locator('[data-current-file="true"]').count(), 1)
  const triggerWords = reading.getByRole("row", { name: /^Trigger words/ })
  assert.equal(await triggerWords.getByRole("listitem").count(), 12)
  const triggerBounds = await triggerWords.getByRole("listitem").evaluateAll(items => items.map(item => {
    const rect = item.getBoundingClientRect(); return { x: rect.x, top: rect.top, bottom: rect.bottom }
  }))
  assert(triggerBounds.every((item, index) => index === 0 || item.x === triggerBounds[0].x && item.top >= triggerBounds[index - 1].bottom), "trigger groups stay vertically separated at wide widths")
  assert.equal(await reading.getByRole("region", { name: "Model description", exact: true }).getByRole("heading", { name: "Model description", exact: true }).count(), 0)
  assert.equal(await reading.getByRole("region", { name: "Version files" }).getByRole("listitem").count(), 4)
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
  assert.equal(await reading.getByRole("region", { name: "Version files" }).getByRole("button").count(), 0)
  await page.getByRole("button", { name: "Civitai", exact: true }).click()
  assert.equal(await reading.getByRole("region", { name: "Library and source" }).count(), 0)
  assert.equal(await civitaiPanel.getByText("B.safetensors · 300", { exact: true }).count(), 1)
  const sourceDetails = civitaiPanel.getByRole("region", { name: "Source details", exact: true })
  assert(await sourceDetails.getByText("Entity", { exact: true }).isVisible())
  await page.setViewportSize({ width: 720, height: 480 })
  const narrowLayout = await Promise.all([reading, sourceDetails].map(locator => locator.evaluate(element => ({
    width: element.clientWidth, content: element.scrollWidth,
  }))))
  assert(narrowLayout.every(layout => layout.content <= layout.width + 1), "provider reading and source properties fit narrow panes")
  const triggerCode = triggerWords.locator("code").filter({ hasText: "a".repeat(96) })
  assert.equal(await triggerCode.evaluate(element => getComputedStyle(element).userSelect), "text")
  await page.screenshot({ path: join(output, "civitai-reading-narrow.png") })
  await page.setViewportSize({ width: 1500, height: 1000 })
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
  // Settings is an excursion over the mounted reader, including DOM-owned state.
  const galleryNode = await stage.elementHandle()
  const readerViewport = reading.locator('xpath=ancestor::*[@data-slot="scroll-area-viewport"][1]')
  await readerViewport.evaluate((element) => {
    element.scrollTop = 180
  })
  const readerScroll = await readerViewport.evaluate((element) => element.scrollTop)
  const galleryImage = await stage.locator("img").getAttribute("src")
  const readerUrl = page.url()
  await page.getByRole("button", { name: "Setting", exact: true }).click()
  await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor()
  await page.keyboard.press("Escape")
  await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor({ state: "hidden" })
  assert.equal(page.url(), readerUrl)
  assert(await galleryNode!.evaluate((element) => element.isConnected))
  assert.equal(await readerViewport.evaluate((element) => element.scrollTop), readerScroll)
  assert.equal(await stage.locator("img").getAttribute("src"), galleryImage)
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
  releaseSwitch()
  await versionDescription("C version description")
  await page.unroute(`**/civitai/${a.componentId}/version?*`)
  await reading
    .getByText("Previous version observation · rereading selected source.", { exact: true })
    .waitFor({ state: "hidden" })
  assert.equal(await reading.getByText(/Previous version observation/).count(), 0)
  assert.equal(await civitaiPanel.getByText("B.safetensors · 300", { exact: true }).count(), 0)
  const originSnapshot = civitaiPanel.getByRole("region", { name: "Local match" })
  assert.equal(await civitaiPanel.getByText(a.componentId!, { exact: true }).count(), 1)
  const originRead = await backend.client.GET("/api/v1/civitai/{component_id}/view", {
    params: { path: { component_id: a.componentId! } },
  })
  assert(originRead.data)
  assert.equal(
    await originSnapshot.getByText(`${originRead.data.record.model.versions.find(version => version.id === originRead.data.record.matched_version)?.name} · ${originRead.data.record.matched_version}`, { exact: true }).count(),
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
  await page.screenshot({ path: join(output, "origin-with-peer-version.png") })
  await reading.getByRole("button", { name: "Inspect managed example", exact: true }).first().click()
  await page.locator('[data-slot="entity-inspection"][data-view-id="image.inspect"]').waitFor()
  await page.getByRole("button", { name: "Setting", exact: true }).click()
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await page.locator('[data-slot="entity-inspection"][data-view-id="image.inspect"]').waitFor()
  await page.getByRole("button", { name: "Return to source", exact: true }).first().click()
  await versionDescription("B version description")
  await page.getByRole("button", { name: "Civitai", exact: true }).click()
  await civitaiPanel.getByText("B.safetensors · 300", { exact: true }).waitFor({ state: "attached" })
  if (!(await page.getByRole("combobox", { name: "Default view", exact: true }).count()))
    await page.getByRole("button", { name: "Overview", exact: true }).click()
  await chooseContentView(page, "File")
  await chooseContentView(page, "Civitai")
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
  await page.getByRole("button", { name: "Civitai", exact: true }).click()
  await civitaiPanel.getByRole("button", { name: "Refresh origin Civitai information", exact: true }).click()
  await civitaiPanel.getByText("Origin operation · complete", { exact: true }).waitFor()
  const view = await backend.client.GET("/api/v1/civitai/{component_id}/view", {
    params: { path: { component_id: a.componentId! } },
  })
  assert.equal(view.data?.host, a.entityId)
  assert.equal(view.data?.record.revision, "1")
  await page.screenshot({ path: join(output, "refreshed-origin.png") })
  // Saved provider HTML retains useful structure, without giving the provider
  // access to the trusted renderer or loading remote resources on presentation.
  const richDescription = `<h3>Rich heading</h3>
    <p onclick="window.__providerExecuted=true" style="position:fixed" id="provider-id"><strong>Bold text</strong> and <em>italic text</em></p>
    <ol start="3"><li>First item</li><li>Second item</li></ol>
    <blockquote>Quoted text</blockquote><pre><code>sample code</code></pre>
    <table><tbody><tr><th>Name</th><td>Value</td></tr></tbody></table>
    <p><a href="/models/7808">Rich source link</a>
    <a href="javascript:window.__providerExecuted=true">Unsafe link</a></p>
    <img src="https://invalid.example/description.png" alt="Saved description image" onerror="window.__providerExecuted=true">
    <iframe src="https://invalid.example/frame"></iframe>
    <svg onload="window.__providerExecuted=true"><foreignObject><p>Foreign content</p></foreignObject></svg>
    <script>window.__providerExecuted=true</script><style>body{display:none}</style>
    <form><input autofocus name="providerInput"></form>`
  await page.route(`**/civitai/${a.componentId}/page`, async (route) => {
    const response = await route.fetch()
    const value = await response.json()
    value.origin.record.model.description = richDescription
    await route.fulfill({ response, json: value })
  })
  await page.route(`**/civitai/${a.componentId}/version?*`, async (route) => {
    const response = await route.fetch()
    const value = await response.json()
    value.version.description =
      "<p><strong>Version-specific rich notes</strong></p><ul><li>Version item</li></ul>"
    await route.fulfill({ response, json: value })
  })
  await reading.getByRole("button", { name: "Reread saved information", exact: true }).click()
  const modelDescription = reading.getByRole("region", { name: "Model description", exact: true })
  await modelDescription.getByRole("heading", { name: "Rich heading", exact: true }).waitFor()
  assert.equal(await modelDescription.locator("strong").innerText(), "Bold text")
  assert.equal(await modelDescription.locator("em").innerText(), "italic text")
  assert.equal(await modelDescription.locator("ol").getAttribute("start"), "3")
  assert.equal(await modelDescription.getByRole("listitem").count(), 2)
  assert.equal(await modelDescription.locator("blockquote").innerText(), "Quoted text")
  assert.equal(await modelDescription.locator("pre code").innerText(), "sample code")
  assert.equal(await modelDescription.getByRole("cell", { name: "Value", exact: true }).count(), 1)
  assert.equal(
    await modelDescription
      .locator("script, style, iframe, svg, img, input, [onclick], [onerror], [style], #provider-id")
      .count(),
    0,
  )
  assert.equal(await modelDescription.getByRole("link", { name: "Unsafe link", exact: true }).count(), 0)
  assert.equal(
    await modelDescription
      .getByRole("link", { name: "Saved description image ↗", exact: true })
      .getAttribute("href"),
    "https://invalid.example/description.png",
  )
  await versionDescription("Version-specific rich notes")
  assert.equal(
    await reading
      .getByRole("region", { name: "Version notes", exact: true })
      .getByRole("listitem")
      .innerText(),
    "Version item",
  )
  const richLink = modelDescription.getByRole("link", { name: "Rich source link", exact: true })
  assert.equal(await richLink.getAttribute("href"), "https://civitai.com/models/7808")
  await richLink.click()
  await page.getByText("Couldn't open link", { exact: true }).waitFor()
  assert.equal(await modelDescription.getByText("Couldn't open link", { exact: true }).count(), 0)
  assert.equal(
    await page.evaluate(() => (window as unknown as Record<string, unknown>).__providerExecuted),
    undefined,
  )
  await page.unroute(`**/civitai/${a.componentId}/page`)
  await page.unroute(`**/civitai/${a.componentId}/version?*`)
  assert.deepEqual(unadmitted, [])
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ result: "passed", output, entities: data.entries }))
} finally {
  await browser.close()
  await preview.close()
  await data.dispose()
}
