import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium } from "playwright"
import { fixture, outputDirectory } from "./fixture.ts"
import { browserPreview } from "./browser-preview.ts"

const data = await fixture()
const backend = await data.start()
const preview = await browserPreview(backend)
const output = await outputDirectory("tag-panels")
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
const errors: string[] = []
page.on("pageerror", (error) => errors.push(error.message))
try {
  const create = async (name: string, parent?: string) => {
    const result = await backend.client.POST("/api/v1/tags", {
      body: { request_id: crypto.randomUUID(), change: { operation: "create", name, parent } },
    })
    assert(result.data?.status === "tag_saved", JSON.stringify(result.error))
    return result.data.tag
  }
  const root = await create("Work")
  const child = await create("Images", root.id)
  const leaf = await create("Portrait", child.id)
  const other = await create("Other")
  const good = await create("Quick success", other.id)
  const bad = await create("Retry me", other.id)
  const delayed = await create("Captured subject", other.id)
  const longName = "星空与城市 — café / " + "非常长的个人标签".repeat(20)
  const long = await create(longName, root.id)
  const longTags = []
  for (let i = 0; i < 4; i++) longTags.push(await create(`A${i} · ${longName}`, root.id))
  for (let i = 0; i < 1000; i++) await create(`Candidate ${String(i).padStart(4, "0")}`, root.id)
  const entityId = data.images[0].entityId
  const secondId = data.images[1].entityId
  const open = async (id = entityId) => {
    await page.goto(`${preview.origin}/#/entity?mode=inspect&entityId=${id}`)
    await page.locator(`[data-slot="entity-inspection"][data-entity-id="${id}"]`).waitFor()
    await page.getByRole("region", { name: "Personal tag summary", exact: true }).waitFor()
  }
  const panel = page.getByRole("complementary", { name: "Overview", exact: true })
  const modal = page.getByRole("dialog", { name: "Tags", exact: true })
  const search = modal.getByLabel("Find an existing tag", { exact: true })
  const assignments = async (id = entityId) => {
    const read = await backend.client.GET("/api/v1/entities/{id}/tags", { params: { path: { id } } })
    assert(read.data)
    return read.data.tag_set?.tags.map((tag) => tag.id) ?? []
  }
  const writes: { entity_id?: string; tag_id?: string; operation: string }[] = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/tags" && request.method() === "POST")
      writes.push(request.postDataJSON().change)
  })
  await open()
  if (!(await panel.isVisible())) await page.getByRole("button", { name: "Overview", exact: true }).click()
  await panel.getByText("No personal tags assigned.", { exact: true }).waitFor()
  assert.equal(await panel.getByRole("textbox", { name: "Notes", exact: true }).count(), 1)
  assert.equal(await page.getByRole("button", { name: "Tags", exact: true }).count(), 0)
  assert.equal(await page.getByRole("region", { name: "Personal tag summary", exact: true }).getByText("No personal tags", { exact: true }).count(), 1)
  await panel.getByRole("button", { name: "Add tags", exact: true }).click()
  await modal.waitFor()
  assert.equal(await modal.getByRole("button", { name: "Done", exact: true }).count(), 0)
  assert.equal(await modal.locator('[data-slot="dialog-footer"]').count(), 0)
  const branch = modal.getByRole("button", { name: "Expand Work", exact: true })
  const branchBounds = (await branch.boundingBox())!
  const rowBounds = (await modal.locator(`[data-add-tag-id="${root.id}"]`).boundingBox())!
  assert(branchBounds.width > rowBounds.width * 0.8, "Expansion must use the broad label area")
  await branch.click({ position: { x: branchBounds.width - 20, y: branchBounds.height / 2 } })
  await modal.locator(`[data-add-tag-id="${child.id}"]`).waitFor()
  await modal.getByRole("button", { name: "Expand Images", exact: true }).click()
  await modal.locator(`[data-add-tag-id="${leaf.id}"]`).waitFor()
  await modal.getByRole("button", { name: "Collapse Images", exact: true }).press("Enter")
  await modal.locator(`[data-add-tag-id="${leaf.id}"]`).waitFor({ state: "hidden" })
  await modal.getByRole("button", { name: "Expand Images", exact: true }).press("Space")
  await modal.locator(`[data-add-tag-id="${leaf.id}"]`).waitFor()
  await search.fill("Work / Images")
  await modal.locator(`[data-add-tag-id="${leaf.id}"]`).waitFor()
  await search.fill("Candidate")
  assert.equal(await modal.locator("[data-add-tag-id]").count(), 1000)
  await modal.getByLabel("Available tags", { exact: true }).evaluate((element) => { element.scrollTop = element.scrollHeight })
  assert(await search.isVisible())
  assert.equal(writes.length, 0, "Searching and browsing must not mutate tags")
  await search.fill("Portrait")
  await modal.getByRole("button", { name: "Add Portrait", exact: true }).click()
  await modal.getByRole("button", { name: "Remove Portrait", exact: true }).waitFor()
  assert.deepEqual(await assignments(), [leaf.id])
  assert.equal(writes.length, 1)
  assert.equal(await modal.getByRole("button", { name: "Remove Portrait", exact: true }).getAttribute("aria-pressed"), "true")
  await modal.getByRole("button", { name: "Remove Portrait", exact: true }).click()
  await modal.getByRole("button", { name: "Add Portrait", exact: true }).waitFor()
  assert.deepEqual(await assignments(), [])
  assert.equal(await modal.getByRole("button", { name: "Add Portrait", exact: true }).getAttribute("aria-pressed"), "false")
  await modal.getByRole("button", { name: "Add Portrait", exact: true }).press("Space")
  await modal.getByRole("button", { name: "Remove Portrait", exact: true }).waitFor()
  assert.deepEqual(await assignments(), [leaf.id])
  assert.equal(writes.length, 3, "Every toggle saves immediately without closing the chooser")
  assert.equal(await modal.getByText("Confirmed · saved", { exact: true }).count(), 0)
  await search.fill("")
  await modal.getByRole("button", { name: "Add Images", exact: true }).click()
  await modal.getByRole("button", { name: "Remove Images", exact: true }).waitFor()
  assert.deepEqual(new Set(await assignments()), new Set([child.id, leaf.id]))
  assert(await modal.getByRole("button", { name: "Collapse Images", exact: true }).isVisible())
  await modal.getByRole("button", { name: "Remove Images", exact: true }).click()
  await modal.getByRole("button", { name: "Add Images", exact: true }).waitFor()
  assert.deepEqual(await assignments(), [leaf.id], "Toggling a parent must preserve its child's independent assignment")
  await page.keyboard.press("Escape")
  await modal.waitFor({ state: "hidden" })
  assert(await panel.getByRole("button", { name: "Add tags", exact: true }).evaluate((element) => element === document.activeElement))
  await panel.getByRole("link", { name: "Portrait", exact: true }).waitFor()
  await page.getByRole("region", { name: "Personal tag summary", exact: true }).getByRole("link", { name: "Portrait", exact: true }).waitFor()
  await panel.getByRole("button", { name: "Remove Portrait from this Entity", exact: true }).click()
  await panel.getByText("No personal tags assigned.", { exact: true }).waitFor()
  assert.deepEqual(await assignments(), [])
  await panel.getByRole("button", { name: "Add tags", exact: true }).click()
  await search.fill("Images")
  await page.keyboard.press("ArrowRight")
  assert.match(page.url(), new RegExp(`entityId=${entityId}`), "Modal arrows must not change Entity")
  await page.route("**/api/v1/tags", async (route) => {
    if (route.request().method() === "POST" && route.request().postDataJSON().change.tag_id === bad.id)
      await route.fulfill({ status: 400, json: { code: "invalid_request", message: "fixture failed assignment" } })
    else await route.continue()
  })
  await search.fill("Retry me")
  await modal.getByRole("button", { name: "Add Retry me", exact: true }).click()
  await modal.getByText(/fixture failed assignment/).waitFor()
  await search.fill("Quick success")
  await modal.getByRole("button", { name: "Add Quick success", exact: true }).click()
  await modal.getByRole("button", { name: "Remove Quick success", exact: true }).waitFor()
  await modal.getByText(/fixture failed assignment/).waitFor()
  const failRemoval = async (route: import("playwright").Route) => {
    const request = route.request()
    if (request.method() === "POST" && request.postDataJSON().change.tag_id === good.id &&
      request.postDataJSON().change.operation === "remove")
      await route.fulfill({ status: 400, json: { code: "invalid_request", message: "fixture failed removal" } })
    else await route.fallback()
  }
  await page.route("**/api/v1/tags", failRemoval)
  await modal.getByRole("button", { name: "Remove Quick success", exact: true }).click()
  await modal.getByText(/fixture failed removal/).waitFor()
  assert.equal(await modal.getByRole("button", { name: "Remove Quick success", exact: true }).getAttribute("aria-pressed"), "true")
  assert((await assignments()).includes(good.id), "Failed removal must not pretend the assignment is gone")
  await page.unroute("**/api/v1/tags", failRemoval)
  await modal.getByRole("button", { name: "Remove Quick success", exact: true }).click()
  await modal.getByRole("button", { name: "Add Quick success", exact: true }).waitFor()
  assert(!(await assignments()).includes(good.id))
  await modal.getByRole("button", { name: "Add Quick success", exact: true }).click()
  await modal.getByRole("button", { name: "Remove Quick success", exact: true }).waitFor()
  await modal.getByText(/fixture failed assignment/).waitFor()
  await modal.getByRole("button", { name: "Close", exact: true }).click()
  await modal.waitFor({ state: "hidden" })
  await panel.getByText(/fixture failed assignment/).waitFor()
  await page.getByRole("button", { name: "Tag changes need attention", exact: true }).waitFor()
  await page.unroute("**/api/v1/tags")
  await panel.getByRole("button", { name: "Add tags", exact: true }).click()
  await search.fill("Captured subject")
  let release!: () => void
  const delay = new Promise<void>((resolve) => { release = resolve })
  let captured = 0
  await page.route("**/api/v1/tags", async (route) => {
    if (route.request().method() === "POST" && route.request().postDataJSON().change.tag_id === delayed.id) {
      captured++
      const body = route.request().postDataJSON().change
      assert.equal(body.entity_id, entityId)
      await delay
    }
    await route.continue()
  })
  await modal.getByRole("button", { name: "Add Captured subject", exact: true }).click()
  await modal.getByRole("button", { name: "Add Captured subject", exact: true }).waitFor()
  assert(await modal.getByRole("button", { name: "Add Captured subject", exact: true }).isDisabled())
  assert.equal(captured, 1)
  await page.keyboard.press("Escape")
  await modal.waitFor({ state: "hidden" })
  await page.getByRole("button", { name: "Next entity", exact: true }).click()
  await page.locator(`[data-slot="entity-inspection"][data-entity-id="${secondId}"]`).waitFor()
  const completed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/tags" &&
    response.request().method() === "POST" && response.request().postDataJSON().change.tag_id === delayed.id)
  release()
  await completed
  await page.unrouteAll({ behavior: "wait" })
  await page.getByRole("region", { name: "Personal tag summary", exact: true }).getByText("No personal tags", { exact: true }).waitFor()
  assert.deepEqual(await assignments(secondId), [])
  await open()
  if (!(await panel.isVisible())) await page.getByRole("button", { name: "Overview", exact: true }).click()
  await panel.getByRole("link", { name: "Captured subject", exact: true }).waitFor()
  assert((await assignments()).includes(delayed.id))
  await panel.getByRole("button", { name: "Add tags", exact: true }).click()
  await search.fill(longName)
  await modal.getByRole("button", { name: `Add ${longName}`, exact: true }).click()
  await modal.getByRole("button", { name: `Remove ${longName}`, exact: true }).waitFor()
  await page.keyboard.press("Escape")
  await modal.waitFor({ state: "hidden" })
  for (const id of [root.id, child.id, leaf.id, other.id, bad.id, ...longTags.map((tag) => tag.id)]) {
    const added = await backend.client.POST("/api/v1/tags", { body: { request_id: crypto.randomUUID(),
      change: { operation: "add", entity_id: entityId, tag_id: id } } })
    assert.equal(added.data?.status, "tag_assignment")
  }
  await page.getByRole("button", { name: "Reread Entity", exact: true }).click()
  const total = (await assignments()).length
  const more = page.getByRole("button", { name: `Show all ${total} personal tags`, exact: true })
  await more.waitFor()
  await more.click()
  assert.equal(await panel.getByRole("link").count(), total + 1)
  assert.equal(await panel.getByRole("button", { name: "Entity ID", exact: true }).count(), 0)
  assert.equal(await panel.getByText("Entity ID", { exact: true }).count(), 1, "Identity is visible without a disclosure control")
  await panel.getByRole("button", { name: "Copy entity id", exact: true }).waitFor()
  assert.equal(await panel.getByRole("list", { name: "Assigned tags", exact: true }).getByRole("listitem").count(), total)
  const strip = page.getByRole("region", { name: "Personal tag summary", exact: true })
  const checkStrip = async () => {
    await page.waitForFunction(() => {
      const strip = document.querySelector('[aria-label="Personal tag summary"]')!
      return [...strip.querySelectorAll("a")].every((chip) => {
        const bounds = chip.getBoundingClientRect()
        const viewport = chip.parentElement!.getBoundingClientRect()
        return bounds.width > 0 && bounds.right <= viewport.right + 1 && bounds.left >= viewport.left - 1
      })
    })
    assert.equal(await strip.evaluate((element) => element.getBoundingClientRect().height), 36)
    assert(await strip.evaluate((element) => element.scrollWidth <= element.clientWidth))
    // Read both values in one DOM snapshot while ResizeObserver updates capacity.
    const visible = await strip.evaluate((element) => ({
      count: element.querySelectorAll("a").length,
      more: element.querySelector('button[aria-label^="Show all "]')?.textContent,
    }))
    assert.equal(visible.more, `+${total - visible.count}`, "Every hidden tag must be included in +N")
    assert(await page.getByRole("button", { name: "Add personal tags", exact: true }).isVisible())
  }
  await checkStrip()
  await page.screenshot({ path: join(output, "tag-panel.png"), animations: "disabled" })
  await page.setViewportSize({ width: 360, height: 800 })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await checkStrip()
  await page.getByRole("button", { name: "Close details panel", exact: true }).click()
  for (const width of [1200, 900, 720, 560, 360]) {
    await page.setViewportSize({ width, height: 800 })
    await checkStrip()
  }
  await page.screenshot({ path: join(output, "tag-strip-narrow.png"), animations: "disabled" })
  await page.getByRole("button", { name: "Add personal tags", exact: true }).click()
  await search.fill("")
  await modal.getByRole("button", { name: "Expand Other", exact: true }).click()
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.screenshot({ path: join(output, "tag-picker-tree.png"), animations: "disabled" })
  await page.setViewportSize({ width: 360, height: 800 })
  await search.fill("Candidate")
  assert(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth))
  await page.screenshot({ path: join(output, "tag-modal-narrow.png"), animations: "disabled" })
  await page.keyboard.press("Escape")
  await modal.waitFor({ state: "hidden" })
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.getByRole("button", { name: "Show personal tags", exact: true }).click()
  await page.screenshot({ path: join(output, "tag-panel.png"), animations: "disabled" })
  assert.deepEqual(errors, [])
  await writeFile(join(output, "result.json"), JSON.stringify({ status: "PASS", candidates: 1000,
    checks: ["no Tag-set/empty/assigned", "search and hierarchy are read-only", "immediate add/remove toggles without confirmation",
      "broad expansion target and keyboard collapse/expand", "selected button stays interactive", "no redundant success copy or footer",
      "failed A remains after successful B", "pending pair cannot duplicate", "late completion belongs to original Entity",
      "modal Escape and focus restore", "long tags and narrow modal", "one identity label when expanded",
      "long chips fit at 360–1200px and +N accounts for every hidden tag", "many assigned tags stay one line with panel expansion",
      "panel and presentation share observed assignments"], errors }, null, 2))
  console.log("PASS Tag panel and assignment modal. " + output)
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png"), animations: "disabled" }).catch(() => {})
  throw error
} finally {
  await browser.close()
  await preview.close()
  await backend.stop()
  await data.dispose()
}
