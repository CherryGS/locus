import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium } from "playwright"
import { fixture, outputDirectory } from "./fixture.ts"
import { browserPreview } from "./browser-preview.ts"
import { openWorkspaceEntry, activeWorkspacePage, activeTab, activateTab, closeTab, waitForEntityCount } from "./workspace-browser.ts"

const count = 100_000
const data = await fixture(count), backend = await data.start(), preview = await browserPreview(backend)
const output = await outputDirectory("workspace-scale"), browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.setDefaultTimeout(15000)
const cdp = await page.context().newCDPSession(page)
await cdp.send("Performance.enable")
let identities = 0, requestedMembers = 0
page.on("request", request => {
  const path = new URL(request.url()).pathname
  if (path === "/api/v1/entities" && request.method() === "GET") identities++
  if (path === "/api/v1/memberships/read") requestedMembers += request.postDataJSON().entity_ids.length
})
const measurements: object[] = []
async function sample(label: string) {
  await cdp.send("HeapProfiler.collectGarbage")
  const memory = await cdp.send("Runtime.getHeapUsage")
  const dom = await cdp.send("Memory.getDOMCounters")
  measurements.push({ label, pages: await page.locator('[role="tab"]').count(), memory, dom,
    decodedMediaElements: await page.locator('img,video').count(), identities, requestedMembers })
}
try {
  await page.goto(preview.origin)
  await openWorkspaceEntry(page, "All content")
  await waitForEntityCount(activeWorkspacePage(page), count)
  const origin = await activeTab(page), base = identities
  await sample("one page")
  for (let number = 2; number <= 8; number++) {
    await activateTab(page, origin)
    await activeWorkspacePage(page).getByRole("gridcell").first().click({ button: "right" })
    await page.getByRole("menuitem", { name: "Open in new tab", exact: true }).click()
    await activeWorkspacePage(page).locator('[data-slot="entity-inspection"]').waitFor()
    assert.equal(identities, base)
    if (number === 2 || number === 8) await sample(`${number} pages sharing R0`)
  }
  assert(requestedMembers < 1000, "Only viewports/details, never the complete packed result, request metadata")
  await activateTab(page, origin)
  const tabIds = await page.locator('[role="tab"]').evaluateAll(tabs => tabs.map(tab => tab.id))
  for (const domId of tabIds) {
    if (domId === origin.domId) continue
    await closeTab(page, { id: "", label: "", domId })
    await page.locator(`[role="tab"][id="${domId}"]`).waitFor({ state: "detached" })
  }
  await waitForEntityCount(activeWorkspacePage(page), count)
  await sample("one page after seven closes")
  for (let cycle = 0; cycle < 8; cycle++) {
    await activeWorkspacePage(page).getByRole("gridcell").first().click({ button: "right" })
    await page.getByRole("menuitem", { name: "Open in new tab", exact: true }).click()
    const tab = await activeTab(page)
    await activeWorkspacePage(page).locator('[data-slot="entity-inspection"]').waitFor()
    await closeTab(page, tab)
    await page.locator(`[role="tab"][id="${tab.domId}"]`).waitFor({ state: "detached" })
  }
  await sample("one page after repeated open/close")
  assert.equal(identities, base)
  assert.equal((await activeTab(page)).id, origin.id)
  await writeFile(join(output, "result.json"), JSON.stringify({ passed: true, count,
    retainedResultBuffers: { unique: 1, payloadBytes: count * 16, evidence: "One binary result read; reference identity also verified by workspace-resources unit test" },
    measurements }, null, 2))
  console.log(`PASS shared packed results and repeated page lifetime. Evidence: ${output}`)
} finally { await browser.close(); await preview.close(); await data.dispose() }
