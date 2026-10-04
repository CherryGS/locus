import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium } from "playwright"
import { fixture, outputDirectory } from "./fixture.ts"
import { browserPreview } from "./browser-preview.ts"
import { openWorkspaceEntry, activeWorkspacePage, activeTab, activateTab, openWorkspaceNotes } from "./workspace-browser.ts"

const data = await fixture(), backend = await data.start(), preview = await browserPreview(backend)
const output = await outputDirectory("workspace-stability"), browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.setDefaultTimeout(15000)
const samples: object[] = []
try {
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
  assert.equal(await activeWorkspacePage(page).getByRole("button", { name: "Locate selected Entity", exact: true }).count(), 0)
  assert.equal(await page.getByRole("button", { name: "Why this matched", exact: true }).count(), 0)
  await page.screenshot({ path: join(output, "detail-toolbar.png"), animations: "disabled" })
  await activeWorkspacePage(page).getByRole("button", { name: "Return to source", exact: true }).click()
  const grid = aRoot.locator('[role="grid"]'), firstCell = grid.getByRole("gridcell").first()
  await grid.waitFor()
  const cellBounds = await firstCell.boundingBox()
  await activateTab(page, b)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert((await grid.evaluate(node => node.clientWidth)) > 0)
  await activateTab(page, a)
  assert.deepEqual(await firstCell.boundingBox(), cellBounds, "The retained list does not collapse/reflow on tab return")
  assert(await activeWorkspacePage(page).getByRole("button", { name: "Locate selected Entity", exact: true }).isEnabled())
  await writeFile(join(output, "result.json"), JSON.stringify({ passed: true, samples }, null, 2))
  console.log(`PASS retained tab layout and simplified detail toolbar. Evidence: ${output}`)
} catch (error) {
  await writeFile(join(output, "failure.json"), JSON.stringify({ error: String(error), samples }, null, 2))
  console.error(output)
  throw error
} finally { await browser.close(); await preview.close(); await data.dispose() }
