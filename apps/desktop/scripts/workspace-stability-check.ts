import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium } from "playwright"
import { fixture, outputDirectory, complete } from "./fixture.ts"
import { browserPreview } from "./browser-preview.ts"
import { openWorkspaceEntry, activeWorkspacePage, activeTab, activateTab, closeTab, openWorkspaceNotes } from "./workspace-browser.ts"

const data = await fixture(), backend = await data.start(), preview = await browserPreview(backend)
const output = await outputDirectory("workspace-stability"), browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.setDefaultTimeout(15000)
const samples: object[] = []
let releaseRead: (() => void) | undefined
let releaseWrite: (() => void) | undefined
async function checkNavigationLayout() {
  const layout = await activeWorkspacePage(page).locator('[data-slot="entity-filmstrip"]').evaluate(strip => {
    const thumbnails = [...strip.querySelectorAll('[aria-describedby]')].map(node => node.getBoundingClientRect())
    const group = strip.getBoundingClientRect()
    const header = document.querySelector('.title-bar')!
    return { pageCenter: document.documentElement.clientWidth / 2,
      stripCenter: (group.left + group.right) / 2,
      thumbnailsCenter: (Math.min(...thumbnails.map(rect => rect.left)) + Math.max(...thumbnails.map(rect => rect.right))) / 2,
      headerNavigations: header.querySelectorAll('nav[aria-label="History"]').length,
      pageNavigations: document.querySelectorAll('[data-workspace-page] nav[aria-label="History"]').length }
  })
  assert(Math.abs(layout.stripCenter - layout.pageCenter) < 1)
  assert(Math.abs(layout.thumbnailsCenter - layout.pageCenter) < 1, "Even counts must center the complete thumbnail group without an empty slot")
  assert.equal(layout.headerNavigations, 1)
  assert.equal(layout.pageNavigations, 0)
  samples.push({ layout })
}
async function trace(label: string, action: () => Promise<unknown>) {
  await page.evaluate("window.__name = (fn) => fn")
  await page.evaluate(() => {
    const samples: object[] = []
    let last = "", frame = 0
    function sample() {
      const root = document.querySelector('[data-workspace-page][data-active="true"]')
      const viewport = root?.querySelector('[data-slot="image-viewport"]')
      const image = viewport?.querySelector<HTMLImageElement>('img:not([data-slot="image-loading-preview"])')
      const state = { page: root?.getAttribute('data-page-id'),
        entity: root?.querySelector('[data-slot="entity-inspection"]')?.getAttribute('data-entity-id'),
        dialog: !!document.querySelector('[data-slot="dialog-content"][data-open]'),
        viewport: viewport?.getAttribute('data-state'), width: viewport?.clientWidth,
        image: image?.getAttribute('src'), decoded: image?.complete, transform: image?.style.transform,
        preview: viewport?.querySelector('img[data-slot="image-loading-preview"]')?.getAttribute('src'),
        selectedPreview: root?.querySelector('[data-slot="entity-filmstrip"] [aria-current="true"] img')?.getAttribute('src'),
        loading: [...root?.querySelectorAll('[role="status"], [data-slot="empty-description"]') ?? []]
          .map(node => node.textContent).filter(text => /Reading current File|Loading image|Reading this Entity/.test(text ?? "")),
        dialogAnimation: document.getAnimations().some(animation =>
          (animation.effect as KeyframeEffect)?.target?.getAttribute('data-slot') === "dialog-overlay") }
      const serialized = JSON.stringify(state)
      if (last !== serialized) samples.push({ at: performance.now(), ...state })
      last = serialized
    }
    const observer = new MutationObserver(sample)
    observer.observe(document.body, { subtree: true, childList: true, attributes: true })
    function tick() { sample(); frame = requestAnimationFrame(tick) }
    tick()
    ;(window as any).stopStabilityTrace = () => { observer.disconnect(); cancelAnimationFrame(frame); return samples }
  })
  await action()
  await page.waitForTimeout(250)
  const trace = await page.evaluate(() => (window as any).stopStabilityTrace())
  samples.push({ label, trace })
  for (const sample of trace) {
    assert(!sample.dialog && !sample.dialogAnimation, `${label}: clean navigation must never flash a confirmation`)
    if (sample.entity && sample.entity === trace[0].entity) {
      assert.equal(sample.viewport, "ready", `${label}: the departing image must remain mounted until the next subject commits`)
      assert.equal(sample.image, trace[0].image)
    }
    if (sample.entity && sample.viewport !== "ready")
      assert(sample.preview, `${label}: use the new subject's qualified preview while its original loads`)
    if (sample.preview) assert.equal(sample.preview, sample.selectedPreview, `${label}: never substitute the previous subject's image`)
    assert.deepEqual(sample.loading, [], `${label}: quick operations must not flash pending messages`)
  }
}
try {
  for (const image of data.images) {
    const generated = await backend.client.POST("/api/v1/previews", { body: {
      request_id: crypto.randomUUID(), target: { kind: "image", component_id: image.componentId }, edge: 512,
    } })
    assert(generated.data)
    assert.equal((await complete(backend.client, generated.data.task_id)).status, "preview")
  }
  await page.goto(preview.origin)
  await openWorkspaceEntry(page, "All content")
  const a = await activeTab(page)
  await activeWorkspacePage(page).getByRole("gridcell").first().dblclick()
  await activeWorkspacePage(page).locator('[data-slot="image-viewport"][data-state="ready"]').waitFor()
  await openWorkspaceNotes(page)
  const aRoot = page.locator(`[data-page-id="${a.id}"]`)
  const imageNode = await aRoot.locator('[data-slot="image-viewport"] img').elementHandle()
  const geometry = () => aRoot.evaluate(root => {
    const strip = root.querySelector('[data-slot="entity-filmstrip"]')!
    const image = root.querySelector('[data-slot="image-viewport"] img')!
    return { pageWidth: root.clientWidth, stripWidth: strip.clientWidth,
      thumbnails: strip.querySelectorAll('[aria-describedby]').length,
      imageTransform: (image as HTMLElement).style.transform,
      imageDecoded: (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0 }
  })
  const before = await geometry()
  await openWorkspaceEntry(page, "All content")
  const b = await activeTab(page)
  await activeWorkspacePage(page).getByRole("grid").waitFor()
  await activeWorkspacePage(page).getByRole("gridcell").nth(1).dblclick()
  await activeWorkspacePage(page).locator('[data-slot="image-viewport"][data-state="ready"]').waitFor()
  await trace("preview B to preview A", () => activateTab(page, a))
  await trace("preview A to preview B", () => activateTab(page, b))
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const hidden = await geometry()
  samples.push({ before, hidden })
  assert.equal(hidden.pageWidth, before.pageWidth, "Hiding a page must not collapse its retained viewport")
  assert.equal(hidden.stripWidth, before.stripWidth)
  assert.equal(hidden.thumbnails, before.thumbnails)
  for (let cycle = 0; cycle < 3; cycle++) {
    await activateTab(page, a)
    const restored = await geometry()
    samples.push({ cycle, restored })
    assert(await imageNode!.evaluate(node => node.isConnected && node === document.querySelector('[data-workspace-page][data-active="true"] [data-slot="image-viewport"] img')))
    assert.deepEqual(restored, before, "Returning retains the decoded image and measured filmstrip without rebuilding an empty layout")
    await activateTab(page, b)
  }
  await activateTab(page, a)
  await trace("next preview", () => activeWorkspacePage(page).getByRole("button", { name: "Next entity", exact: true }).click())
  await trace("previous preview", () => activeWorkspacePage(page).getByRole("button", { name: "Previous entity", exact: true }).click())
  const original = activeWorkspacePage(page).locator('[data-slot="entity-inspection"]')
  assert.equal(await original.getAttribute('data-entity-id'), data.images[0].entityId)
  // A slow original uses only its own thumbnail, remains busy, and cannot
  // replace a later selection when its abandoned request eventually finishes.
  await page.route(`**/files/${data.images[1].fileId}/bytes`, async route => {
    await new Promise<void>(resolve => { releaseRead = resolve })
    await route.continue().catch(() => {})
  })
  await activeWorkspacePage(page).getByRole("button", { name: "Next entity", exact: true }).click()
  await activeWorkspacePage(page).getByText("Loading image…", { exact: true }).waitFor()
  assert.equal(await original.getAttribute('data-entity-id'), data.images[1].entityId)
  assert(await activeWorkspacePage(page).locator('[data-slot="image-loading-preview"]').isVisible())
  assert.equal(await activeWorkspacePage(page).locator('[data-slot="image-viewport"]').getAttribute('aria-busy'), "true")
  await activeWorkspacePage(page).getByRole("button", { name: "Next entity", exact: true }).click()
  await activeWorkspacePage(page).locator('[data-slot="image-viewport"][data-state="ready"]').waitFor()
  releaseRead!(); releaseRead = undefined
  await page.unroute(`**/files/${data.images[1].fileId}/bytes`)
  assert.equal(await original.getAttribute('data-entity-id'), data.images[2].entityId)
  await page.route(`**/files/${data.images[1].fileId}/bytes`, route => route.abort())
  await activeWorkspacePage(page).getByRole("button", { name: "Previous entity", exact: true }).click()
  await activeWorkspacePage(page).getByText("Image input unavailable", { exact: true }).waitFor()
  assert.equal(await activeWorkspacePage(page).locator('[data-slot="image-loading-preview"]').count(), 0)
  await page.unroute(`**/files/${data.images[1].fileId}/bytes`)
  await original.getByRole("button", { name: "Retry image", exact: true }).click()
  await activeWorkspacePage(page).locator('[data-slot="image-viewport"][data-state="ready"]').waitFor()
  assert.equal(await activeWorkspacePage(page).getByRole("button", { name: "Locate selected Entity", exact: true }).count(), 0)
  assert.equal(await activeWorkspacePage(page).getByRole("button", { name: "Refresh library", exact: true }).count(), 0)
  assert.equal(await activeWorkspacePage(page).locator('[aria-label="Browsing status"]').count(), 0)
  assert.equal(await page.getByRole("button", { name: "Why this matched", exact: true }).count(), 0)
  await page.waitForFunction(() => document.querySelector('[data-workspace-page][data-active="true"] [data-slot="entity-inspection"]')?.getAttribute('aria-busy') === "false")
  await checkNavigationLayout()
  await page.screenshot({ path: join(output, "detail-toolbar.png"), animations: "disabled" })
  await page.setViewportSize({ width: 720, height: 480 })
  await checkNavigationLayout()
  await page.screenshot({ path: join(output, "detail-toolbar-minimum.png"), animations: "disabled" })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByRole("navigation", { name: "History", exact: true }).getByRole("button", { name: "Return to source", exact: true }).click()
  const grid = aRoot.locator('[role="grid"]'), firstCell = grid.getByRole("gridcell").first()
  await grid.waitFor()
  const cellBounds = await firstCell.boundingBox()
  await activateTab(page, b)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert((await grid.evaluate(node => node.clientWidth)) > 0)
  await activateTab(page, a)
  assert.deepEqual(await firstCell.boundingBox(), cellBounds, "The retained list does not collapse/reflow on tab return")
  assert(await activeWorkspacePage(page).getByRole("button", { name: "Locate selected Entity", exact: true }).isEnabled())
  await trace("close inactive preview", () => closeTab(page, b))
  await openWorkspaceEntry(page, "All content")
  const c = await activeTab(page)
  await trace("close active page", () => closeTab(page, c))
  assert.equal((await activeTab(page)).id, a.id)
  await openWorkspaceEntry(page, "All content")
  const dirty = await activeTab(page)
  await activeWorkspacePage(page).getByRole("gridcell").first().dblclick()
  const notes = await openWorkspaceNotes(page)
  await page.route(`**/api/v1/entities/${data.images[0].entityId}/notes`, async route => {
    if (route.request().method() !== "PUT") { await route.continue(); return }
    const response = await route.fetch()
    await new Promise<void>(resolve => { releaseWrite = resolve })
    await route.fulfill({ response })
  })
  await notes.fill("Closing waits for this confirmed save")
  await closeTab(page, dirty)
  await page.getByRole("dialog", { name: `Close ${dirty.label}`, exact: true }).getByText("Preparing page edits…", { exact: true }).waitFor()
  assert.equal(await page.locator(`[data-page-id="${dirty.id}"]`).count(), 1, "Slow save keeps its page alive")
  releaseWrite!(); releaseWrite = undefined
  await page.locator(`[data-page-id="${dirty.id}"]`).waitFor({ state: "detached" })
  await page.getByRole("dialog", { name: `Close ${dirty.label}`, exact: true }).waitFor({ state: "hidden" })
  await page.waitForFunction(() => !document.getAnimations().some(animation =>
    (animation.effect as KeyframeEffect)?.target?.getAttribute('data-slot') === "dialog-overlay"))
  await page.unroute(`**/api/v1/entities/${data.images[0].entityId}/notes`)
  const saved = await backend.client.GET("/api/v1/entities/{entity_id}/notes", { params: { path: { entity_id: data.images[0].entityId } } })
  assert.equal(saved.data?.notes, "Closing waits for this confirmed save")
  await trace("close final page", () => closeTab(page, a))
  await page.getByText("Open a workspace", { exact: true }).waitFor()
  await writeFile(join(output, "result.json"), JSON.stringify({ passed: true, samples }, null, 2))
  console.log(`PASS retained tab layout and simplified detail toolbar. Evidence: ${output}`)
} catch (error) {
  await writeFile(join(output, "failure.json"), JSON.stringify({ error: String(error), samples }, null, 2))
  console.error(output)
  throw error
} finally { releaseRead?.(); releaseWrite?.(); await browser.close(); await preview.close(); await data.dispose() }
