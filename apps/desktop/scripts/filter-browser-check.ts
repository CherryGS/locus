import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { chromium } from "playwright"
import { readEntityIds } from "@locus/client"
import { civitaiFixture } from "./civitai-fixture.ts"
import { browserPreview } from "./browser-preview.ts"
import { outputDirectory } from "./fixture.ts"
import { chooseContentView } from "./content-view-choice.ts"
import { checkFilterAssistance } from "./filter-assistance-browser.ts"

const data = await civitaiFixture(),
  backend = await data.start(),
  preview = await browserPreview(backend)
const output = await outputDirectory("entity-filter"),
  browser = await chromium.launch({ headless: true })
let diagnosticPage: import("playwright").Page | undefined
try {
  const deadline = Date.now() + 120000
  while (true) {
    const status = (await backend.client.GET("/api/v1/search/status")).data!
    if (status.usable && status.covered_sequence === status.journal_head) break
    assert(Date.now() < deadline, JSON.stringify(status))
    await delay(100)
  }
  const all = await readEntityIds(backend.client)
  const catalogue = (await backend.client.GET("/api/v1/search/catalogue")).data!
  const identity = catalogue.fields.find((f) => f.id === "entity_id")!
  assert(identity)
  const page = await browser.newPage({
      viewport: { width: 1200, height: 800 },
    }),
    errors: string[] = []
  diagnosticPage = page
  page.on("pageerror", (error) => errors.push(error.message))
  let enumerations = 0,
    searches = 0
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname
    if (path === "/api/v1/entities") enumerations++
    if (path === "/api/v1/search/query") searches++
  })
  await page.goto(`${preview.origin}/#/entity`)
  const grid = page.locator('[role="grid"][aria-label="Entities"]')
  await grid.waitFor()
  const filter = page.getByRole("button", { name: /^Filter(?: · applied)?$/ })
  const embeddedTrigger = await filter.evaluate(button => {
    const group = button.closest('[data-slot="input-group"]'), box = button.getBoundingClientRect()
    return { search: group?.querySelector('input')?.getAttribute("placeholder"), width: box.width, height: box.height }
  })
  assert.deepEqual(embeddedTrigger, { search: "Search entities…", width: 24, height: 24 }, "Filter shares Search's input frame and uses a square icon target")
  const dialog = page.getByRole("dialog", { name: "Filter Entities" })
  const open = async () => {
    await filter.click()
    await dialog.waitFor()
  }
  const apply = async () => {
    await dialog.getByRole("button", { name: "Apply", exact: true }).click()
    await dialog.waitFor({ state: "hidden" })
  }
  await open()
  assert.equal(await dialog.getByText(/^(New draft|Saved preset|Unsaved draft)$/).count(), 0)
  const source = dialog.getByRole("textbox", {
    name: "Filter source",
    exact: true,
  })
  // Preset management lives in the chooser; there is no competing options layer.
  const chooser = page.getByRole("dialog", { name: "Choose a preset", exact: true })
  assert.equal(await dialog.getByRole("button", { name: "Filter options", exact: true }).count(), 0)
  await dialog.getByRole("button", { name: "Load preset", exact: true }).click()
  await chooser.waitFor()
  await page.waitForFunction(() => document.activeElement?.id === "filter-preset-search")
  await page.screenshot({ path: join(output, "exclusive-preset-layer.png") })
  await page.keyboard.press("Escape")
  await chooser.waitFor({ state: "hidden" })
  await page.waitForFunction(() => document.activeElement?.id === "filter-preset")
  assert.equal(await source.inputValue(), "")
  // The chooser yields focus to the outer editor instead of trapping it or
  // restoring the trigger after an outside interaction.
  await dialog.getByRole("button", { name: "Load preset", exact: true }).click()
  await chooser.waitFor()
  await source.click({ position: { x: 8, y: 8 } })
  await chooser.waitFor({ state: "hidden" })
  await page.waitForFunction(() => document.activeElement?.id === "filter-source")
  assert.equal(await source.inputValue(), "")
  await dialog.getByRole("button", { name: "Load preset", exact: true }).click()
  await chooser.waitFor()
  await page.waitForFunction(() => document.activeElement?.id === "filter-preset-search")
  await chooser.getByRole("button", { name: "Close", exact: true }).press("Tab")
  await chooser.waitFor({ state: "hidden" })
  await page.waitForFunction(() => document.activeElement?.textContent === "New")
  assert.equal(await source.inputValue(), "")
  assert(await dialog.evaluate(element => element.contains(document.activeElement)))
  const quietValidation = async () => {
    assert.equal(await dialog.getByText(/^(Query valid|All Entities|Analyzing current source…|Assisted editing · finish to validate source)$/).count(), 0)
  }
  const validateSource = async (text: string) => {
    const response = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v1/filter/analyze" && response.request().postDataJSON().text === text)
    await source.fill(text)
    assert.equal((await (await response).json()).state, "valid")
    await quietValidation()
  }
  await checkFilterAssistance(page, dialog, source, catalogue, output)
  await source.fill("+entity_id:* unknown_field:value -entity_id:missing")
  await dialog.getByText("Source invalid", { exact: true }).waitFor()
  await source.fill('@name("removed", entity_id:*)')
  await dialog.getByRole("button", { name: /Unsupported reserved call/ }).waitFor()
  await validateSource('"@sql(literal)"')
  await validateSource('entity_id:IN ["" " " "a  b" "a · b"]')
  assert.equal(await dialog.getByLabel("Parsed interpretation").count(), 0)
  // Explicit delayed analysis fault: an older valid response cannot clear a newer error.
  let releaseAnalysis!: () => void, analysisReceived!: () => void
  const heldAnalysis = new Promise<void>((resolve) => {
    releaseAnalysis = resolve
  })
  const firstAnalysis = new Promise<void>((resolve) => {
    analysisReceived = resolve
  })
  await page.route("**/api/v1/filter/analyze", async (route) => {
    if (route.request().postDataJSON().text !== "entity_id:*") {
      await route.continue()
      return
    }
    const response = await route.fetch()
    analysisReceived()
    await heldAnalysis
    await route.fulfill({ response })
  })
  await source.fill("entity_id:*")
  await firstAnalysis
  await quietValidation()
  await source.fill("(")
  releaseAnalysis()
  await dialog.getByRole("button", { name: /Native syntax:/ }).waitFor()
  await dialog.getByText("Source invalid", { exact: true }).waitFor()
  await page.unroute("**/api/v1/filter/analyze")
  // Explicit unavailable-validation fault keeps the draft editable and supports retry.
  await page.route("**/api/v1/filter/analyze", async (route) => {
    const response = await route.fetch(),
      body = await response.json()
    body.state = "unavailable"
    body.diagnostics = [{ start: 0, end: body.source.text.length, message: "Injected validation outage" }]
    await route.fulfill({ response, json: body })
  })
  await source.fill("entity_id:*")
  await dialog.getByText("Source unavailable", { exact: true }).waitFor()
  assert.equal(await source.inputValue(), "entity_id:*")
  await page.unroute("**/api/v1/filter/analyze")
  const recoveredAnalysis = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/filter/analyze")
  await dialog.getByRole("button", { name: "Retry analysis", exact: true }).click()
  assert.equal((await (await recoveredAnalysis).json()).state, "valid")
  await dialog.getByText("Source unavailable", { exact: true }).waitFor({ state: "hidden" })
  await quietValidation()
  await validateSource("model_tensor_count:*\nAND file_byte_count:[0 TO *]")
  await source.click()
  // The catalogue scrolls below the raw editor without moving or editing it.
  const currentSource = await source.inputValue()
  await dialog.getByRole("button", { name: "Fields", exact: true }).click()
  const fields = dialog.getByRole("complementary", { name: "Field reference", exact: true })
  await fields.getByLabel("Find fields", { exact: true }).waitFor()
  assert.equal(await dialog.getByRole("button", { name: "Close", exact: true }).count(), 1)
  await dialog.evaluate((element) => Promise.allSettled(element.getAnimations().map((animation) => animation.finished)))
  const identityType = await fields.locator('[data-field-id="entity_id"] span').boundingBox()
  const dimensionType = await fields.locator('[data-field-id="image_width"] span').boundingBox()
  assert(identityType && dimensionType && identityType.x === dimensionType.x && identityType.width === dimensionType.width)
  assert.equal(await fields.getByRole("button", { name: /^Copy / }).count(), 0)
  const unresized = await dialog.boundingBox()
  assert(unresized)
  await page.mouse.move(unresized.x + unresized.width - 3, unresized.y + unresized.height - 3)
  await page.mouse.down()
  await page.mouse.move(unresized.x + unresized.width + 80, unresized.y + unresized.height + 24, { steps: 8 })
  await page.mouse.up()
  await dialog.evaluate((element) => Promise.allSettled(element.getAnimations().map((animation) => animation.finished)))
  const resized = await dialog.boundingBox()
  assert(resized && resized.width > unresized.width && resized.height > unresized.height)
  assert(resized.x >= 0 && resized.y >= 0 && resized.x + resized.width <= 1200 && resized.y + resized.height <= 800)
  await page.mouse.move(resized.x + resized.width - 3, resized.y + resized.height - 3)
  await page.mouse.down()
  await page.mouse.move(resized.x + resized.width - 180, resized.y + resized.height - 130, { steps: 8 })
  await page.mouse.up()
  await dialog.evaluate((element) => Promise.allSettled(element.getAnimations().map((animation) => animation.finished)))
  const narrowed = await dialog.boundingBox()
  assert(narrowed && narrowed.width < resized.width && narrowed.height < resized.height)
  const shortLabel = await fields.locator('[data-field-id="entity_id"] code').boundingBox()
  const longerLabel = await fields.locator('[data-field-id="model_tensor_count"] code').boundingBox()
  assert(shortLabel && longerLabel && longerLabel.height === shortLabel.height)
  const sourceBeforeScroll = await source.boundingBox()
  const fieldBox = await fields.boundingBox()
  assert(sourceBeforeScroll && fieldBox && fieldBox.y >= sourceBeforeScroll.y + sourceBeforeScroll.height)
  const fieldScroll = fields.getByLabel("Field list", { exact: true })
  await fieldScroll.evaluate((element) => { element.scrollTop = element.scrollHeight })
  assert(await fieldScroll.evaluate((element) => element.scrollTop > 0))
  assert.deepEqual(await source.boundingBox(), sourceBeforeScroll)
  const fieldSearch = fields.getByLabel("Find fields", { exact: true })
  await fieldSearch.fill("entity_id")
  const identityRow = fields.locator('[data-field-id="entity_id"]')
  assert.equal(await identityRow.getByRole("button").count(), 0)
  const identityText = identityRow.locator("code")
  assert.equal(await identityText.textContent(), identity.native_value)
  assert.equal(await identityText.evaluate((element) => getComputedStyle(element).userSelect), "text")
  const textBox = await identityText.boundingBox()
  assert(textBox)
  const sourceBeforeSelection = await source.boundingBox()
  await page.mouse.move(textBox.x + 1, textBox.y + textBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(textBox.x + Math.min(50, textBox.width - 1), textBox.y + textBox.height / 2, { steps: 8 })
  await page.mouse.up()
  const selectedField = await page.evaluate(() => window.getSelection()?.toString())
  assert(selectedField && identity.native_value.includes(selectedField), selectedField)
  assert.deepEqual(await source.boundingBox(), sourceBeforeSelection)
  assert.equal(await dialog.evaluate((element) => element.scrollTop), 0)
  await fieldSearch.fill("tag_names")
  await fields.locator('[data-field-reference-row="tag_names exact field"] code').waitFor()
  await fieldSearch.fill("no_such_field")
  await fields.getByText("No matching fields", { exact: true }).waitFor()
  await fieldSearch.fill("")
  assert.equal(await source.inputValue(), currentSource)
  await page.screenshot({ path: join(output, "field-reference.png") })
  await dialog.getByRole("button", { name: "Fields", exact: true }).click()
  await fields.waitFor({ state: "hidden" })
  await page.waitForFunction(() => document.activeElement?.id === "filter-source")
  await dialog.getByRole("button", { name: "Save", exact: true }).click()
  await page.getByRole("dialog", { name: "Save preset", exact: true })
    .getByRole("button", { name: "Cancel", exact: true }).click()
  assert.equal(await source.inputValue(), "model_tensor_count:*\nAND file_byte_count:[0 TO *]")
  await page.getByRole("button", { name: "Save As", exact: true }).click()
  await page.getByRole("dialog", { name: "Save As", exact: true })
    .getByRole("button", { name: "Cancel", exact: true }).click()
  await page.waitForFunction(
    () => document.activeElement?.id === "filter-source",
  )
  assert(await dialog.isVisible())
  await quietValidation()
  await source.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(output, "filter-normal.png") })
  await dialog.getByRole("button", { name: "Save", exact: true }).click()
  const nameDialog = page.getByRole("dialog", { name: "Save preset", exact: true })
  await nameDialog.getByRole("textbox", { name: "Name", exact: true }).fill("Models")
  await nameDialog.getByRole("button", { name: "Confirm name", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  await page.locator('[data-entity-count="4"]').waitFor()
  assert.equal(enumerations, 1)
  assert.equal((await backend.client.GET("/api/v1/filter/presets")).data?.length, 1)
  const a = data.entries.find((entry) => entry.name === "A")!
  await page.locator(`[role="gridcell"][id$="-${a.entityId}"]`).click()
  await page.getByRole("button", { name: "Overview", exact: true }).click()
  await page.getByRole("button", { name: "Why this matched", exact: true }).click()
  await page
    .getByLabel("Original result match evidence")
    .getByText("Query condition · required", { exact: true })
    .waitFor()
  await page.locator(`[role="gridcell"][id$="-${a.entityId}"]`).dblclick()
  await chooseContentView(page, "Civitai")
  const reading = page.locator('[data-slot="civitai-page"]')
  await reading.getByRole("button", { name: "Inspect managed example", exact: true }).first().click()
  await page.locator('[data-slot="image-viewport"][data-state="ready"]').waitFor()
  const previewId = await page.locator('[data-slot="entity-inspection"]').getAttribute("data-entity-id")
  assert(
    !data.entries.some((entry) => entry.entityId === previewId),
    "Excluded related example has its own context",
  )
  await page.keyboard.press("Escape")
  await reading.waitFor()
  await page.keyboard.press("Escape")
  await grid.waitFor()
  await page.locator('[data-entity-count="4"]').waitFor()

  // Real native text plus structured conditions; query fields come from catalogue.
  await open()
  await dialog
    .getByRole("textbox", { name: "Filter source", exact: true })
    .fill(`${identity.native_exact}:"${a.entityId}"`)
  await apply()
  await page.locator('[data-entity-count="1"]').waitFor()
  await open()
  await dialog.getByRole("textbox", { name: "Filter source", exact: true }).fill('unknown_field:"unfinished')
  await dialog.getByRole("button", { name: "Apply", exact: true }).click()
  await dialog.getByRole("alert").first().waitFor()
  assert(await dialog.isVisible())
  assert.equal(await page.locator("[data-entity-count]").getAttribute("data-entity-count"), "1")
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await page.getByRole("button", { name: "Setting", exact: true }).click()
  await page.keyboard.press("Escape")
  await open()
  assert.equal(
    await dialog.getByRole("textbox", { name: "Filter source", exact: true }).inputValue(),
    'unknown_field:"unfinished',
  )
  await dialog.getByRole("button", { name: "Clear", exact: true }).click()
  // Explicit fault injection: ordinary Clear+Apply does not depend on search/catalogue.
  await page.route("**/api/v1/search/query", (route) =>
    route.fulfill({
      status: 503,
      json: { code: "unavailable", message: "Injected unavailable index" },
    }),
  )
  const beforeClear = searches
  await apply()
  await page.locator(`[data-entity-count="${all.length}"]`).waitFor()
  assert.equal(searches, beforeClear)
  await page.unroute("**/api/v1/search/query")

  // Invalid text persists byte-for-byte and does not replace the established result.
  await open()
  await source.fill('unknown_field:"unfinished')
  await dialog.getByRole("button", { name: "Save", exact: true }).click()
  await dialog.getByText(/Saved “Models” with problems:/).waitFor()
  assert.equal(
    await page.locator("[data-entity-count]").getAttribute("data-entity-count"),
    String(all.length),
  )
  const saved = (await backend.client.GET("/api/v1/filter/presets")).data![0]
  assert.equal(
    (
      await backend.client.GET("/api/v1/filter/presets/{id}", {
        params: { path: { id: saved.id } },
      })
    ).data!.source.text,
    'unknown_field:"unfinished',
  )
  await source.fill("entity_id:*")
  await dialog.getByRole("button", { name: "New", exact: true }).click()
  await page
    .getByRole("dialog", { name: "Unsaved Filter edits" })
    .getByRole("button", { name: "Cancel", exact: true })
    .click()
  assert.equal(await source.inputValue(), "entity_id:*")
  await dialog.getByRole("button", { name: "New", exact: true }).click()
  await page
    .getByRole("dialog", { name: "Unsaved Filter edits" })
    .getByRole("button", { name: "Save and switch", exact: true })
    .click()
  await page.waitForFunction(() => (document.getElementById("filter-source") as HTMLTextAreaElement)?.value === "")
  assert(await dialog.isVisible(), "Guard save application keeps the destination editor open")
  assert.equal(await source.inputValue(), "")
  await source.fill("entity_id:*")
  await apply()
  await page.locator(`[data-entity-count="${all.length}"]`).waitFor()
  await open()
  await dialog.getByRole("button", { name: "Clear", exact: true }).click()
  await apply()

  // Explicit delayed-query fault: Close abandons, reopened editor remains open.
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let requested!: () => void
  const request = new Promise<void>((resolve) => {
    requested = resolve
  })
  await page.route("**/api/v1/search/query", async (route) => {
    const response = await route.fetch()
    requested()
    await held
    await route.fulfill({ response })
  })
  await open()
  await dialog
    .getByRole("textbox", { name: "Filter source", exact: true })
    .fill(`${identity.native_exact}:"${a.entityId}"`)
  await dialog.getByRole("button", { name: "Apply", exact: true }).click()
  await request
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await open()
  release()
  await delay(150)
  assert(await dialog.isVisible())
  assert.equal(
    await page.locator("[data-entity-count]").getAttribute("data-entity-count"),
    String(all.length),
  )
  await page.unroute("**/api/v1/search/query")
  await apply()
  await page.locator('[data-entity-count="1"]').waitFor()

  await open()
  await dialog
    .getByRole("textbox", { name: "Filter source", exact: true })
    .fill(`${identity.native_exact}:"01992853-c123-7000-8000-000000000001"`)
  await apply()
  await page.getByText("No matches", { exact: true }).last().waitFor()
  assert.equal(await page.getByText("No entities yet.", { exact: true }).count(), 0)
  await open()
  await dialog
    .getByRole("textbox", { name: "Filter source", exact: true })
    .fill(`${identity.native_exact}:"${a.entityId}"`)
  await apply()
  await page.locator('[data-entity-count="1"]').waitFor()

  // Explicit malformed complete-transfer injection keeps the established result.
  await page.route("**/api/v1/search/query", async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, body: Buffer.alloc(16) })
  })
  await open()
  await dialog.getByRole("button", { name: "Apply", exact: true }).click()
  await dialog.getByRole("alert").first().waitFor()
  assert.equal(await page.locator("[data-entity-count]").getAttribute("data-entity-count"), "1")
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await page.unroute("**/api/v1/search/query")

  // Task View excludes new target from fixed main result, performs only bounded presence.
  const path = join(data.root, "direct-target.txt")
  await writeFile(path, "independent task result")
  const receipt = await backend.client.POST("/api/v1/import-batches", {
    body: { request_id: randomUUID(), source_paths: [path] },
  })
  assert(receipt.data)
  await page.getByRole("button", { name: /^Tasks/ }).click()
  const record = page.locator("[data-task-record]").filter({ hasText: "1 complete" }).last()
  await record.click()
  const targetRow = page.locator("article").filter({ hasText: path })
  await targetRow.waitFor()
  const beforeView = enumerations
  await targetRow.getByRole("button", { name: "View", exact: true }).click()
  await page.getByText("Direct Entity · temporary single-Entity view", { exact: true }).waitFor()
  assert.equal(enumerations, beforeView)
  assert.equal(await page.getByRole("button", { name: "Next entity", exact: true }).isEnabled(), false)
  // A direct Model owns the same related-gallery return as a main Model.
  const b = data.entries.find((entry) => entry.name === "B")!
  await page.evaluate((id) => {
    const [path, query] = location.hash.split("?")
    const search = new URLSearchParams(query)
    search.set("entityId", id)
    location.hash = `${path}?${search}`
  }, b.entityId)
  await page.locator(`[data-slot="entity-inspection"][data-entity-id="${b.entityId}"]`).waitFor()
  if (!(await page.getByRole("combobox", { name: "Default view", exact: true }).isVisible()))
    await page.getByRole("button", { name: "Overview", exact: true }).click()
  await chooseContentView(page, "Civitai")
  await reading.getByRole("button", { name: "Inspect managed example", exact: true }).first().click()
  await page.locator('[data-slot="image-viewport"][data-state="ready"]').waitFor()
  await page.keyboard.press("Escape")
  await reading.waitFor()
  await page.getByText("Direct Entity · temporary single-Entity view", { exact: true }).waitFor()
  await page.keyboard.press("Escape")
  await grid.waitFor()
  await page.locator('[data-entity-count="1"]').waitFor()

  // Index read/recovery feedback and modal minimum size/focus remain real UI.
  await page.route("**/api/v1/search/status", (route) =>
    route.fulfill({
      status: 500,
      json: { code: "failed", message: "Injected status read failure" },
    }),
  )
  await page.setViewportSize({ width: 720, height: 480 })
  await open()
  await dialog.getByText(/Index status unknown/).waitFor()
  // Exercise retry while failure remains stable; regular status polling may
  // remove this control immediately once the route is restored.
  await dialog.getByRole("button", { name: "Retry status read", exact: true }).click()
  await page.unroute("**/api/v1/search/status")
  await dialog.getByText(/Index status unknown/).waitFor({ state: "hidden" })
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await page.getByRole("button", { name: "Setting", exact: true }).click()
  await page.getByRole("button", { name: "Library", exact: true }).click()
  assert.equal(await page.getByText("Advanced maintenance", { exact: true }).count(), 0)
  const statistics = page.getByLabel("Published index statistics")
  await statistics.waitFor()
  assert.match(await statistics.innerText(), /\d+ documents · [\d.,]+ (bytes|KiB|MiB|GiB|TiB)/)
  assert.equal(await page.getByRole("button", { name: "Check index status", exact: true }).count(), 0)
  assert.equal(await page.getByRole("button", { name: "Retry status read", exact: true }).count(), 0)
  await page.getByRole("button", { name: "Rebuild index", exact: true }).click()
  await page.keyboard.press("Escape")
  await open()
  assert(await dialog.isVisible())
  assert.equal(await page.locator("[data-entity-count]").getAttribute("data-entity-count"), "1")
  const box = await dialog.boundingBox()
  assert(box && box.y >= 0 && box.y + box.height <= 480)
  await validateSource("model_tensor_count:*\nAND file_byte_count:[0 TO *]")
  await source.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(output, "filter-minimum.png") })
  await dialog.getByRole("button", { name: "Fields", exact: true }).click()
  await fields.getByLabel("Find fields", { exact: true }).waitFor()
  await dialog.evaluate((element) => Promise.allSettled(element.getAnimations().map((animation) => animation.finished)))
  const compactBox = await dialog.boundingBox()
  assert(compactBox && compactBox.x >= 0 && compactBox.y >= 0 &&
    compactBox.x + compactBox.width <= 720 && compactBox.y + compactBox.height <= 480)
  assert(await fields.evaluate((element) => element.scrollWidth <= element.clientWidth))
  const compactList = await fields.getByLabel("Field list", { exact: true }).boundingBox()
  const compactEditor = await dialog.getByLabel("Filter editor", { exact: true }).boundingBox()
  const compactSource = await source.boundingBox()
  assert(compactEditor && compactSource && compactSource.y >= compactEditor.y &&
    compactSource.y + compactSource.height <= compactEditor.y + compactEditor.height)
  const firstField = await fields.locator('[data-field-reference-row="entity_id query field"]').boundingBox()
  assert(compactList && firstField && firstField.y >= compactList.y &&
    firstField.y + firstField.height <= compactList.y + compactList.height,
    JSON.stringify({ compactList, firstField }))
  assert(await dialog.getByRole("button", { name: "Apply", exact: true }).isVisible())
  await page.screenshot({ path: join(output, "field-reference-minimum.png") })
  await dialog.getByRole("button", { name: "Fields", exact: true }).click()
  await fields.waitFor({ state: "hidden" })
  await page.keyboard.press("Escape")
  await dialog.waitFor({ state: "hidden" })
  assert(await filter.evaluate((element) => element === document.activeElement))
  const failedMain = await browser.newPage()
  failedMain.on("pageerror", (error) => errors.push(error.message))
  await failedMain.route("**/api/v1/entities", (route) =>
    route.fulfill({
      status: 500,
      json: { code: "failed", message: "Injected initial main-read failure" },
    }),
  )
  await failedMain.goto(
    `${preview.origin}/#/entity?entityId=${b.entityId}&mode=inspect&collectionId=direct&direct=true`,
  )
  await failedMain.locator(`[data-slot="entity-inspection"][data-entity-id="${b.entityId}"]`).waitFor()
  assert.equal(await failedMain.getByText("Library observation unavailable", { exact: true }).count(), 0)
  await failedMain.close()
  const absent = await browser.newPage()
  await absent.goto(
    `${preview.origin}/#/entity?entityId=01992853-c123-7000-8000-000000000001&mode=inspect&collectionId=library`,
  )
  await absent.getByText("Entity unavailable in this list", { exact: true }).waitFor()
  assert(
    absent.url().includes("mode=inspect"),
    "Initial complete enumeration must retain the requested missing history destination",
  )
  await absent.close()
  // Explicitly delay the first enumeration and an Apply. Closing Apply after
  // it supersedes startup leaves no complete result, and must offer a real
  // retry instead of claiming that a read is still pending indefinitely.
  const superseded = await browser.newPage()
  let releaseInitial!: () => void, initialReceived!: () => void
  const initialHeld = new Promise<void>((resolve) => {
    releaseInitial = resolve
  })
  const initialRequest = new Promise<void>((resolve) => {
    initialReceived = resolve
  })
  let firstEnumeration = true
  await superseded.route("**/api/v1/entities", async (route) => {
    if (!firstEnumeration) {
      await route.continue()
      return
    }
    firstEnumeration = false
    const response = await route.fetch()
    initialReceived()
    await initialHeld
    await route.fulfill({ response })
  })
  let releaseApplication!: () => void, applicationReceived!: () => void
  const applicationHeld = new Promise<void>((resolve) => {
    releaseApplication = resolve
  })
  const applicationRequest = new Promise<void>((resolve) => {
    applicationReceived = resolve
  })
  await superseded.route("**/api/v1/search/query", async (route) => {
    const response = await route.fetch()
    applicationReceived()
    await applicationHeld
    await route.fulfill({ response })
  })
  await superseded.goto(`${preview.origin}/#/entity`)
  await initialRequest
  await superseded.getByRole("button", { name: /^Filter/ }).click()
  const pendingDialog = superseded.getByRole("dialog", {
    name: "Filter Entities",
  })
  await pendingDialog
    .getByRole("textbox", { name: "Filter source", exact: true })
    .fill(`${identity.native_exact}:"${a.entityId}"`)
  await pendingDialog.getByRole("button", { name: "Apply", exact: true }).click()
  await applicationRequest
  await pendingDialog.getByRole("button", { name: "Close", exact: true }).click()
  releaseInitial()
  releaseApplication()
  await superseded.getByText("No library result loaded", { exact: true }).waitFor()
  await superseded.getByRole("button", { name: "Retry library read", exact: true }).click()
  await superseded.getByRole("grid", { name: "Entities", exact: true }).waitFor()
  await superseded.close()
  // A stored CRLF/Unicode/large-lexeme draft survives actual load/save and a small edit.
  const raw = 'entity_id:*\r\nOR entity_id:"中文😀  18446744073709551615"'
  const language = (await backend.client.GET("/api/v1/filter/language")).data!
  const created = (
    await backend.client.POST("/api/v1/filter/presets", {
      body: {
        request_id: randomUUID(),
        change: {
          operation: "create",
          name: "Raw fidelity",
          source: { format: language.format, version: language.version, text: raw },
        },
      },
    })
  ).data!
  assert(created.status === "filter_saved")
  const managedPreset = (await backend.client.POST("/api/v1/filter/presets", { body: {
    request_id: randomUUID(), change: { operation: "create", name: "Managed separately", source: { ...created.preset.source } },
  } })).data!
  assert(managedPreset.status === "filter_saved")
  await page.setViewportSize({ width: 1200, height: 800 })
  await open()
  await source.fill("entity_id:*")
  const picker = page.getByRole("dialog", { name: "Choose a preset", exact: true })
  await dialog.getByRole("button", { name: "Load preset" }).click()
  await picker.getByRole("textbox", { name: "Search presets" }).fill("Raw")
  await picker.getByRole("button", { name: "Load Raw fidelity", exact: true }).click()
  await picker.waitFor({ state: "hidden" })
  const guard = page.getByRole("dialog", { name: "Unsaved Filter edits" })
  await guard.getByRole("button", { name: "Cancel", exact: true }).click()
  assert.equal(await source.inputValue(), "entity_id:*")
  await dialog.getByRole("button", { name: "Load preset" }).click()
  await picker.getByRole("button", { name: "Load Raw fidelity", exact: true }).click()
  await guard.getByRole("button", { name: "Discard", exact: true }).click()
  await dialog.getByRole("button", { name: "Load preset", exact: true }).getByText("Raw fidelity", { exact: true }).waitFor()
  await source.waitFor()
  await page.waitForFunction(() => document.activeElement?.id === "filter-preset")
  assert.equal(await source.inputValue(), raw.replaceAll("\r\n", "\n"))
  await dialog.getByRole("button", { name: "Save", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  const readRaw = async () =>
    (await backend.client.GET("/api/v1/filter/presets/{id}", { params: { path: { id: created.preset.id } } }))
      .data!.source.text
  assert.equal(await readRaw(), raw)
  await open()
  await quietValidation()
  const beforePickerClose = await source.inputValue()
  const beforeManagementSearches = searches
  await dialog.getByRole("button", { name: "Load preset", exact: true }).click()
  await picker.getByRole("button", { name: "Rename preset Managed separately", exact: true }).click()
  await picker.waitFor({ state: "hidden" })
  const renamePreset = page.getByRole("dialog", { name: "Rename preset", exact: true })
  await renamePreset.getByRole("textbox", { name: "Name", exact: true }).fill("Managed renamed")
  await renamePreset.getByRole("button", { name: "Confirm name", exact: true }).click()
  await dialog.getByRole("button", { name: "Load preset", exact: true }).click()
  await picker.getByRole("button", { name: "Load Managed renamed", exact: true }).waitFor()
  await page.screenshot({ path: join(output, "preset-management.png") })
  await picker.getByRole("button", { name: "Delete preset Managed renamed", exact: true }).click()
  await page.getByRole("dialog", { name: "Delete “Managed renamed”?", exact: true })
    .getByRole("button", { name: "Confirm delete", exact: true }).click()
  await dialog.getByRole("button", { name: "Load preset", exact: true }).click()
  await picker.getByRole("button", { name: "Load Managed renamed", exact: true }).waitFor({ state: "hidden" })
  await page.keyboard.press("Escape")
  assert.equal(await source.inputValue(), beforePickerClose)
  assert.equal(searches, beforeManagementSearches)
  assert(!((await backend.client.GET("/api/v1/filter/presets")).data!).some(preset => preset.id === managedPreset.preset.id))
  await dialog.getByRole("button", { name: "Load preset" }).click()
  await picker.getByRole("textbox", { name: "Search presets" }).fill("No such preset")
  await picker.getByText("No matching presets", { exact: true }).waitFor()
  await picker.getByRole("textbox", { name: "Search presets" }).fill("")
  await picker.getByRole("button", { name: "Load Raw fidelity", exact: true }).waitFor()
  await picker.getByRole("button").last().press("Tab")
  await picker.waitFor({ state: "hidden" })
  await page.waitForFunction(() => document.activeElement?.textContent === "New")
  assert.equal(await source.inputValue(), beforePickerClose)
  await dialog.getByRole("button", { name: "Load preset", exact: true }).click()
  assert.equal(await picker.getByRole("button", { name: "Cancel", exact: true }).count(), 0)
  await picker.getByRole("button", { name: "Close", exact: true }).click()
  await picker.waitFor({ state: "hidden" })
  assert.equal(await source.inputValue(), beforePickerClose)
  assert(await dialog.getByRole("button", { name: "Load preset", exact: true }).evaluate((element) => element === document.activeElement))
  await dialog.getByRole("button", { name: "Load preset", exact: true }).click()
  await page.screenshot({ path: join(output, "preset-picker.png"), animations: "disabled" })
  await page.keyboard.press("Escape")
  await picker.waitFor({ state: "hidden" })
  assert(await dialog.isVisible())
  await source.fill(` ${raw.replaceAll("\r\n", "\n")}`)
  await dialog.getByRole("button", { name: "Save", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  assert.equal(await readRaw(), ` ${raw}`)
  // Explicit response-loss fault after an actual committed write; recover by request receipt.
  await open()
  await source.fill(`  ${raw.replaceAll("\r\n", "\n")}`)
  const beforeLostSave = searches
  await page.route("**/api/v1/filter/presets", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue()
      return
    }
    await route.fetch()
    await route.abort("failed")
  })
  await dialog.getByRole("button", { name: "Save", exact: true }).click()
  await dialog.getByText(`Unconfirmed update · ${created.preset.id}`, { exact: true }).click()
  assert.equal(searches, beforeLostSave)
  await page.unroute("**/api/v1/filter/presets")
  await dialog.getByRole("button", { name: "Reconcile uncertain operation", exact: true }).click()
  await dialog
    .getByText("Confirmed saved “Raw fidelity”. Load it explicitly to reconcile the draft.", { exact: true })
    .waitFor()
  assert.equal(await readRaw(), `  ${raw}`)
  assert(await dialog.isVisible())
  // Header search and modal Filter retain separate authored/applied state.
  await page.keyboard.press("Escape")
  const aId = data.entries.find(entry => entry.name === "A")!.entityId
  const bId = data.entries.find(entry => entry.name === "B")!.entityId
  const pair = `entity_id:"${aId}" OR entity_id:"${bId}"`
  const single = `entity_id:"${aId}"`
  const headerSearch = page.getByRole("textbox", { name: "Search entities", exact: true })
  await open(); await source.fill(pair); await apply()
  await grid.locator('[data-entity-count="2"]').waitFor()
  await open(); await source.fill("entity_id:*"); await page.keyboard.press("Escape")
  await headerSearch.fill(single)
  const combined = page.waitForRequest(request => new URL(request.url()).pathname === "/api/v1/search/query" && request.postDataJSON().text === `(${single}) AND (${pair})`)
  await headerSearch.press("Enter"); await combined
  await grid.locator('[data-entity-count="1"]').waitFor()
  assert(await headerSearch.evaluate(element => element === document.activeElement), "search retains focus after application")
  const displayBounds = await page.locator('[data-slot="header-display"]').boundingBox()
  assert(displayBounds && Math.abs(displayBounds.x + displayBounds.width / 2 - 600) < 1, "page status is centered in the global header")
  assert.equal(await page.locator('[data-slot="entity-page-header"]').getByRole("heading").count(), 0)
  await open(); assert.equal(await source.inputValue(), "entity_id:*"); await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Clear search", exact: true }).click()
  await grid.locator('[data-entity-count="2"]').waitFor()
  await open(); await source.fill(""); await apply()
  await headerSearch.fill(single); await headerSearch.press("Enter")
  await grid.locator('[data-entity-count="1"]').waitFor()
  assert.equal(await filter.getAttribute("aria-label"), "Filter")
  await headerSearch.fill("unknown_field:value"); await headerSearch.press("Enter")
  await page.getByText("Search could not be applied", { exact: true }).waitFor()
  assert.equal(await grid.locator('[data-entity-count]').getAttribute("data-entity-count"), "1")
  assert.equal(await headerSearch.inputValue(), "unknown_field:value")
  await page.getByRole("button", { name: "Clear search", exact: true }).click()
  await page.getByText("Search could not be applied", { exact: true }).waitFor({ state: "hidden" })
  await page.screenshot({ path: join(output, "header-search.png") })
  assert.deepEqual(errors, [])
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        catalogueFields: catalogue.fields.length,
        searches,
        enumerations,
        corpus: all.length,
        scenarios: [
          "live transient assistance, provenance, delayed lexical responses, field/value acceptance and bounds",
          "native manual source, IME, declared choices, observed paging/reuse/failure/refresh and action precedence",
          "raw multiline source and CRLF/Unicode/large-lexeme round trip",
          "stale validation rejection and unavailable validation recovery",
          "preset dialog search, selection, dirty guard and Escape return",
          "quoted empty/whitespace/set values",
          "native kind query and read-only roles",
          "unsupported helpers and quoted exceptions",
          "durable valid Save and saved-invalid source",
          "lost committed Save response and explicit receipt recovery",
          "dirty guard Save applies before New",
          "native complete results",
          "evidence",
          "failure retention",
          "zero matches",
          "malformed transfer",
          "clear index bypass",
          "late Apply",
          "related return",
          "task singleton bounded read",
          "direct gallery return",
          "initial main failure",
          "missing history target",
          "superseded startup recovery",
          "index recovery",
          "minimum viewport",
          "Escape focus",
        ],
      },
      null,
      2,
    ),
  )
  console.log(`PASS real Filter renderer. ${output}`)
} catch (error) {
  await diagnosticPage?.screenshot({ path: join(output, "failure.png") }).catch(() => {})
  if (diagnosticPage)
    await writeFile(
      join(output, "failure.txt"),
      `${String(error)}\n${await diagnosticPage.locator("body").innerText()}`,
    )
  throw error
} finally {
  await browser.close()
  await preview.close()
  await data.dispose()
}
