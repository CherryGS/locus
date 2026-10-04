import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { chromium } from "playwright"
import { fixture, outputDirectory } from "./fixture.ts"
import { browserPreview } from "./browser-preview.ts"
import { chooseContentView, waitForContentViewSaved } from "./content-view-choice.ts"
import { activeWorkspacePage, openWorkspaceEntry, activeTab, activateTab, closeTab,
  waitForEntityCount, searchWorkspace, inspectWorkspaceEntity, openWorkspaceNotes } from "./workspace-browser.ts"

const data = await fixture(), backend = await data.start(), preview = await browserPreview(backend)
const output = await outputDirectory("workspace")
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors: string[] = [], cases: string[] = []
page.on("pageerror", error => errors.push(error.message))
page.setDefaultTimeout(15000)
let queries = 0
page.on("request", request => {
  const pathname = new URL(request.url()).pathname
  if ((pathname === "/api/v1/entities" && request.method() === "GET") || pathname === "/api/v1/search/query") queries++
})
const completed = (name: string) => { cases.push(name); console.log(`PASS ${name}`) }
const filterSource = (id: string) => `entity_id:"${id}"`
const [first, second] = data.images.map(image => image.entityId)
let releaseWrite: (() => void) | undefined
try {
  await page.goto(preview.origin)
  await page.getByRole("button", { name: "Locus", exact: true }).waitFor()
  assert.equal(await page.locator('[role="tab"]').count(), 0)
  assert.equal(queries, 0, "empty startup must not start a browsing query")
  assert.equal(await page.getByRole("navigation", { name: "Main navigation", exact: true }).count(), 0)
  await openWorkspaceEntry(page, "Settings")
  await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor()
  await page.keyboard.press("Escape")
  await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor({ state: "hidden" })
  assert.equal(await page.locator('[role="tab"]').count(), 0)
  await page.getByRole("button", { name: /^Tasks/ }).click()
  await page.getByRole("dialog", { name: "Tasks this run" }).waitFor()
  await page.keyboard.press("Escape")
  completed("empty startup and global Settings/tasks")

  await openWorkspaceEntry(page, "All content")
  const a = await activeTab(page)
  await waitForEntityCount(activeWorkspacePage(page), 4)
  await searchWorkspace(page, filterSource(first), 1)
  await openWorkspaceEntry(page, "All content")
  const b = await activeTab(page)
  assert.notEqual(a.id, b.id)
  await waitForEntityCount(activeWorkspacePage(page), 4)
  await searchWorkspace(page, filterSource(second), 1)
  await activateTab(page, a)
  assert.equal(await activeWorkspacePage(page).getByRole("textbox", { name: "Search entities", exact: true }).inputValue(), filterSource(first))
  await waitForEntityCount(activeWorkspacePage(page), 1)
  completed("independent page criteria and result state")
  const aTrigger = page.locator(`[role="tab"][id="${a.domId}"]`)
  await aTrigger.focus()
  await aTrigger.press("ArrowRight")
  await page.waitForFunction(id => document.activeElement?.id === id, b.domId)
  assert.equal((await activeTab(page)).id, a.id, "Arrow keys move focus before explicit activation")
  await page.keyboard.press("Enter")
  await page.waitForFunction(id => document.getElementById(id)?.getAttribute("aria-selected") === "true", b.domId)
  assert.equal((await activeTab(page)).id, b.id)
  await page.locator(`[role="tab"][id="${b.domId}"]`).press("ArrowLeft")
  await page.keyboard.press("Enter")
  await page.waitForFunction(id => document.getElementById(id)?.getAttribute("aria-selected") === "true", a.domId)
  const controlledPanel = await aTrigger.getAttribute("aria-controls")
  assert(controlledPanel)
  assert.equal(await page.locator(`[id="${controlledPanel}"]`).getAttribute("role"), "tabpanel")
  assert.equal(await page.locator(`[id="${controlledPanel}"]`).getAttribute("aria-labelledby"), a.domId)
  completed("keyboard tab switching and associated page panels")

  const beforeHandoff = queries
  await activeWorkspacePage(page).getByRole("gridcell").first().click({ button: "right" })
  await page.getByRole("menuitem", { name: "Open in new tab", exact: true }).click()
  const c = await activeTab(page)
  assert.notEqual(c.id, a.id)
  await activeWorkspacePage(page).locator(`[data-slot="entity-inspection"][data-entity-id="${first}"]`).waitFor()
  assert.equal(queries, beforeHandoff, "context handoff reuses the established sequence")
  await activeWorkspacePage(page).getByRole("button", { name: "Return to source", exact: true }).click()
  await waitForEntityCount(activeWorkspacePage(page), 1)
  await activateTab(page, a)
  await searchWorkspace(page, "entity_id:*", 4)
  await activateTab(page, c)
  await closeTab(page, a)
  await page.getByRole("tab", { name: a.label, exact: true }).waitFor({ state: "detached" })
  assert.equal((await activeTab(page)).id, c.id, "background source close must not steal activation")
  await waitForEntityCount(activeWorkspacePage(page), 1)
  await inspectWorkspaceEntity(page, first)
  completed("exact R0 survives source replacement and background source close")

  await openWorkspaceNotes(page)
  await chooseContentView(page, "File")
  await waitForContentViewSaved(page)
  await activeWorkspacePage(page).getByRole("button", { name: "Return to source", exact: true }).click()
  await activeWorkspacePage(page).getByRole("gridcell").first().click({ button: "right" })
  await page.getByRole("menuitem", { name: "Open in new tab", exact: true }).click()
  const d = await activeTab(page)
  await activeWorkspacePage(page).locator('[data-slot="entity-inspection"][data-view-id="file.info"]').waitFor()
  await openWorkspaceNotes(page)
  await activateTab(page, c)
  await inspectWorkspaceEntity(page, first)
  await openWorkspaceNotes(page)
  await chooseContentView(page, "Image")
  await waitForContentViewSaved(page)
  await activateTab(page, d)
  await activeWorkspacePage(page).locator('[data-slot="entity-inspection"][data-view-id="file.info"]').waitFor()
  completed("already-open presentations stay independent of remembered default")

  const notesPath = `/api/v1/entities/${first}/notes`
  let puts = 0
  let entered: () => void = () => {}
  const firstDelivered = new Promise<void>(resolve => { entered = resolve })
  await page.route(`**${notesPath}`, async route => {
    if (route.request().method() !== "PUT") { await route.continue(); return }
    puts++
    if (puts !== 1) { await route.continue(); return }
    const response = await route.fetch()
    entered()
    await new Promise<void>(resolve => { releaseWrite = resolve })
    await route.fulfill({ response })
  })
  await activateTab(page, c)
  let notes = await openWorkspaceNotes(page)
  await notes.fill("C captured notes")
  await notes.press("Control+Enter")
  await Promise.race([firstDelivered, delay(15000, undefined, { ref: false }).then(() => { throw new Error("Notes request did not reach its response gate") })])
  await activateTab(page, d)
  notes = await openWorkspaceNotes(page)
  await notes.fill("D independent draft")
  await notes.press("Control+Enter")
  await activeWorkspacePage(page).getByRole("region", { name: "Entity notes" }).getByText("Saving…", { exact: true }).waitFor()
  assert.equal(puts, 1, "another tab must not bypass the pending Notes submission lane")
  await activateTab(page, c)
  assert.equal(await (await openWorkspaceNotes(page)).inputValue(), "C captured notes")
  const secondSaved = page.waitForResponse(response => response.request().method() === "PUT" && new URL(response.url()).pathname === notesPath && response.request().postDataJSON().notes === "D independent draft")
  releaseWrite!(); releaseWrite = undefined
  await secondSaved
  await page.unroute(`**${notesPath}`)
  await page.waitForFunction(() => document.querySelector('[data-workspace-page][data-active="true"] textarea')?.textContent === "D independent draft" ||
    (document.querySelector('[data-workspace-page][data-active="true"] textarea') as HTMLTextAreaElement | null)?.value === "D independent draft")
  const savedNotes = await backend.client.GET("/api/v1/entities/{entity_id}/notes", { params: { path: { entity_id: first } } })
  assert.equal(savedNotes.data?.notes, "D independent draft")
  completed("private Notes drafts, ordered writes and shared confirmed observations")

  await activateTab(page, b)
  await waitForEntityCount(activeWorkspacePage(page), 1)
  await openWorkspaceEntry(page, "Media")
  const media = await activeTab(page)
  await waitForEntityCount(activeWorkspacePage(page), 3)
  await searchWorkspace(page, `NOT (${filterSource(first)})`, 2)
  await searchWorkspace(page, "", 3)
  await openWorkspaceEntry(page, "Models")
  await waitForEntityCount(activeWorkspacePage(page), 0)
  completed("fixed category AND user criteria; clearing retains category")

  await openWorkspaceEntry(page, "Tags")
  const tags = await activeTab(page), beforeTags = await page.locator('[role="tab"]').count()
  await openWorkspaceEntry(page, "Tags")
  assert.equal(await page.locator('[role="tab"]').count(), beforeTags)
  assert.equal((await activeTab(page)).id, tags.id)
  await page.getByRole("button", { name: "New root tag", exact: true }).click()
  const createTag = page.getByRole("dialog", { name: "Create a tag", exact: true })
  await createTag.getByRole("textbox", { name: "Tag name", exact: true }).fill("Retained tab context")
  await createTag.getByRole("button", { name: "Create tag", exact: true }).click()
  await createTag.waitFor({ state: "hidden" })
  await activeWorkspacePage(page).getByLabel("Find tags", { exact: true }).fill("Retained")
  await closeTab(page, tags)
  await page.getByRole("tab", { name: tags.label, exact: true }).waitFor({ state: "detached" })
  await openWorkspaceEntry(page, "Tags")
  assert.equal(await activeWorkspacePage(page).getByLabel("Find tags", { exact: true }).inputValue(), "Retained")
  completed("unique Tag page retains same-run context after close/reopen")

  // A failed off-screen editor stays owned by its original page. Resolving it
  // returns to that Entity, rather than whichever Entity happens to be open.
  await activateTab(page, c)
  notes = await openWorkspaceNotes(page)
  await page.route(`**${notesPath}`, route => route.request().method() === "PUT"
    ? route.fulfill({ status: 500, json: { code: "operation_failed", message: "Workspace notes recovery fixture" } })
    : route.continue())
  await notes.fill("Recover the original page draft")
  await notes.press("Control+Enter")
  await activeWorkspacePage(page).getByText("Workspace notes recovery fixture", { exact: true }).waitFor()
  await activateTab(page, media)
  await closeTab(page, c)
  const closeDialog = page.getByRole("dialog", { name: `Close ${c.label}`, exact: true })
  await closeDialog.getByRole("button", { name: "Return to page", exact: true }).click()
  assert.equal((await activeTab(page)).id, c.id)
  await activeWorkspacePage(page).locator(`[data-slot="entity-inspection"][data-entity-id="${first}"]`).waitFor()
  assert.equal(await (await openWorkspaceNotes(page)).inputValue(), "Recover the original page draft")
  await page.unroute(`**${notesPath}`)
  const recovered = page.waitForResponse(response => response.request().method() === "PUT" && new URL(response.url()).pathname === notesPath)
  await activeWorkspacePage(page).getByRole("button", { name: "Retry save", exact: true }).click()
  await recovered
  await closeTab(page, c)
  await page.locator(`[role="tab"][id="${c.domId}"]`).waitFor({ state: "detached" })
  completed("off-screen unconfirmed Notes blocks close and resolves at its owner")

  const importedName = "workspace-task-result-with-a-deliberately-long-name-for-tab-overflow.txt"
  const importedPath = join(data.root, importedName)
  await writeFile(importedPath, "Independent direct result")
  const receipt = await backend.client.POST("/api/v1/import-batches", {
    body: { request_id: randomUUID(), source_paths: [importedPath] },
  })
  assert(receipt.data)
  await page.getByRole("button", { name: /^Tasks/ }).click()
  const tasks = page.getByRole("dialog", { name: "Tasks this run", exact: true })
  await tasks.locator("[data-task-record]").filter({ hasText: "1 complete" }).click()
  const resultRow = tasks.locator("article").filter({ hasText: importedPath })
  await resultRow.getByRole("button", { name: "View", exact: true }).waitFor()
  let enteredPresence!: () => void
  const presenceEntered = new Promise<void>(resolve => { enteredPresence = resolve })
  let releasePresence!: () => void
  const heldPresence = new Promise<void>(resolve => { releasePresence = resolve })
  await page.route("**/api/v1/memberships/read", async route => {
    const response = await route.fetch()
    enteredPresence()
    await heldPresence
    await route.fulfill({ response })
  })
  const beforeTaskTabs = await page.locator('[role="tab"]').count()
  await resultRow.getByRole("button", { name: "View", exact: true }).click()
  await presenceEntered
  await page.keyboard.press("Escape")
  await tasks.waitFor({ state: "hidden" })
  await page.getByRole("button", { name: /^Tasks/ }).click()
  releasePresence()
  await page.unrouteAll({ behavior: "wait" })
  await tasks.getByText(/^Viewing was superseded/).waitFor()
  assert.equal(await page.locator('[role="tab"]').count(), beforeTaskTabs)
  const taskSource = await activeTab(page), beforeDirectQuery = queries
  await resultRow.getByRole("button", { name: "View", exact: true }).click()
  await tasks.waitFor({ state: "hidden" })
  await activeWorkspacePage(page).locator('[data-slot="entity-inspection"]').waitFor()
  assert.equal(await page.locator('[role="tab"]').count(), beforeTaskTabs + 1)
  assert.equal(queries, beforeDirectQuery, "direct task entry cannot enumerate the library")
  const directTab = await activeTab(page)
  assert.equal(directTab.label, importedName)
  assert.notEqual(directTab.id, taskSource.id)
  await page.setViewportSize({ width: 720, height: 480 })
  const directTrigger = page.locator(`[role="tab"][id="${directTab.domId}"]`)
  assert.equal(await directTrigger.getAttribute("title"), importedName)
  const directBounds = await directTrigger.boundingBox()
  assert(directBounds && directBounds.width <= 224)
  await directTrigger.scrollIntoViewIfNeeded()
  assert(await directTrigger.locator("..").getByRole("button", { name: /^Close / }).isVisible())
  await page.screenshot({ path: join(output, "workspace-long-tab-narrow.png"), animations: "disabled" })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.keyboard.press("Escape")
  await page.locator(`[role="tab"][id="${directTab.domId}"]`).waitFor({ state: "detached" })
  assert.equal((await activeTab(page)).id, taskSource.id)
  await page.waitForFunction(id => document.activeElement?.id === id, taskSource.domId)
  completed("dismissed task View cannot open late; completed direct detail closes on Escape")

  await openWorkspaceEntry(page, "All content")
  const presetTab = await activeTab(page)
  await activeWorkspacePage(page).getByRole("button", { name: /^Filter/ }).click()
  const filterDialog = page.getByRole("dialog", { name: "Filter Entities", exact: true })
  await filterDialog.getByRole("textbox", { name: "Filter source", exact: true }).fill(filterSource(first))
  await filterDialog.getByRole("button", { name: "Save", exact: true }).click()
  const naming = page.getByRole("dialog", { name: "Save preset", exact: true })
  await naming.getByRole("textbox", { name: "Name", exact: true }).fill("Workspace close fixture")
  await naming.getByRole("button", { name: "Confirm name", exact: true }).click()
  await filterDialog.waitFor({ state: "hidden" })
  await waitForEntityCount(activeWorkspacePage(page), 1)
  await activeWorkspacePage(page).getByRole("button", { name: /^Filter/ }).click()
  await filterDialog.getByRole("textbox", { name: "Filter source", exact: true }).fill(filterSource(second))
  await page.keyboard.press("Escape")
  await activateTab(page, media)
  await closeTab(page, presetTab)
  const presetClose = page.getByRole("dialog", { name: `Close ${presetTab.label}`, exact: true })
  await presetClose.getByRole("button", { name: "Cancel", exact: true }).click()
  assert.equal((await activeTab(page)).id, media.id)
  await closeTab(page, presetTab)
  await presetClose.getByRole("button", { name: "Save and close", exact: true }).click()
  await page.locator(`[role="tab"][id="${presetTab.domId}"]`).waitFor({ state: "detached" })
  assert.equal((await activeTab(page)).id, media.id)
  const presets = await backend.client.GET("/api/v1/filter/presets")
  const preset = presets.data!.find(value => value.name === "Workspace close fixture")!
  const savedPreset = await backend.client.GET("/api/v1/filter/presets/{id}", { params: { path: { id: preset.id } } })
  assert.equal(savedPreset.data?.source.text, filterSource(second))
  completed("background saved-preset close supports cancel and confirmed Save without switching pages")

  await activateTab(page, media)
  await page.setViewportSize({ width: 720, height: 480 })
  await page.screenshot({ path: join(output, "workspace-narrow.png"), animations: "disabled" })
  assert(await page.getByRole("button", { name: "Locus", exact: true }).isVisible())
  assert(await page.getByRole("tab", { selected: true }).isVisible())
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.screenshot({ path: join(output, "workspace-desktop.png"), animations: "disabled" })
  while (await page.locator('[role="tab"]').count()) {
    const firstTab = page.getByRole("tab").first()
    const label = (await firstTab.textContent())!.trim()
    const domId = (await firstTab.getAttribute("id"))!
    await closeTab(page, { label, domId, id: "" })
    await page.locator(`[role="tab"][id="${domId}"]`).waitFor({ state: "detached" })
  }
  await page.getByText("Open a workspace", { exact: true }).waitFor()
  await openWorkspaceEntry(page, "Settings")
  await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor()
  await page.keyboard.press("Escape")
  completed("final page close leaves a usable empty workspace")
  assert.deepEqual(errors, [])
  await writeFile(join(output, "result.json"), JSON.stringify({ passed: true, cases, queries, errors }, null, 2))
  console.log(`PASS real internal workspace. Evidence: ${output}`)
} catch (error) {
  console.error(`Workspace cases completed: ${JSON.stringify(cases)}. Evidence: ${output}`)
  await page.screenshot({ path: join(output, "failure.png"), animations: "disabled" }).catch(() => {})
  await writeFile(join(output, "failure.json"), JSON.stringify({ cases, queries, errors, error: String(error) }, null, 2))
  throw error
} finally {
  releaseWrite?.()
  await browser.close()
  await preview.close()
  await data.dispose()
}
