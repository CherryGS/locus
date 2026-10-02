import assert from "node:assert/strict"
import { join } from "node:path"
import { chromium } from "playwright"
import { fixture, outputDirectory } from "./fixture.ts"
import { browserPreview } from "./browser-preview.ts"

const data = await fixture()
let backend = await data.start()
let preview = await browserPreview(backend)
const output = await outputDirectory("overview")
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 820 } })
const errors: string[] = []
page.on("pageerror", (error) => errors.push(error.message))
const entity = data.images[0].entityId
const second = data.images[1].entityId
const path = `/api/v1/entities/${entity}/notes`
const overview = page.getByRole("complementary", { name: "Overview", exact: true })
const notes = overview.getByRole("textbox", { name: "Notes", exact: true })
const open = async (id = entity) => {
  await page.goto(`${preview.origin}/#/entity?mode=inspect&entityId=${id}`)
  await page.locator(`[data-slot="entity-inspection"][data-entity-id="${id}"]`).waitFor()
  if (!await overview.isVisible()) await page.getByRole("button", { name: "Overview", exact: true }).click()
  await notes.waitFor()
  await page.waitForFunction(() => !document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Add a note, an idea, a reminder…"]')?.disabled)
}
const read = async (id = entity) => {
  const result = await backend.client.GET("/api/v1/entities/{entity_id}/notes", { params: { path: { entity_id: id } } })
  assert(result.data, JSON.stringify(result.error))
  return result.data.notes
}
const saveResponse = () => page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname === path)
try {
  for (const name of ["Inspiration", "Composition", "Warm light", "待整理", "Photography"]) {
    const tag = await backend.client.POST("/api/v1/tags", { body: { request_id: crypto.randomUUID(), change: { operation: "create", name } } })
    assert(tag.data?.status === "tag_saved")
    await backend.client.POST("/api/v1/tags", { body: { request_id: crypto.randomUUID(), change: { operation: "add", tag_id: tag.data.tag.id, entity_id: entity } } })
  }
  await open()
  assert.equal(await notes.inputValue(), "")
  assert.equal(await page.getByRole("button", { name: "Tags", exact: true }).count(), 0)
  const text = "留意画面里的光影层次。\nA reference for the next collection.\nhttps://example.com/reference"
  let saved = saveResponse()
  await notes.fill(text)
  await saved
  await overview.getByRole("region", { name: "Entity notes" }).getByText("Saved", { exact: true }).waitFor()
  assert.equal(await read(), text)
  await page.screenshot({ path: join(output, "overview.png"), animations: "disabled" })
  await notes.press("ArrowRight")
  assert(page.url().includes(entity), "Typing shortcuts must not navigate")
  await page.reload()
  if (!await overview.isVisible()) await page.getByRole("button", { name: "Overview", exact: true }).click()
  await page.waitForFunction((text) => document.querySelector<HTMLTextAreaElement>("textarea")?.value === text, text)

  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let entered!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() === "PUT") { entered(); await gate }
    await route.continue()
  })
  saved = saveResponse()
  await notes.fill("Saved to the original Entity")
  await notes.press("Control+Enter")
  await started
  await page.getByRole("button", { name: "Next entity", exact: true }).click()
  await page.locator(`[data-slot="entity-inspection"][data-entity-id="${second}"]`).waitFor()
  release()
  await saved
  await page.unrouteAll({ behavior: "wait" })
  assert.equal(await read(), "Saved to the original Entity")
  assert.equal(await read(second), "")
  await page.getByRole("button", { name: "Previous entity", exact: true }).click()
  await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>("textarea")?.value === "Saved to the original Entity")

  await page.route(`**${path}`, (route) => route.request().method() === "PUT"
    ? route.fulfill({ status: 500, json: { code: "operation_failed", message: "Temporary notes failure" } })
    : route.continue())
  await notes.fill("Keep this unsaved draft")
  await overview.getByText("Temporary notes failure", { exact: true }).waitFor()
  await page.getByRole("button", { name: "Close details panel", exact: true }).click()
  await page.getByRole("button", { name: "Overview", exact: true }).click()
  assert.equal(await notes.inputValue(), "Keep this unsaved draft")
  await page.unrouteAll({ behavior: "wait" })
  saved = saveResponse()
  await overview.getByRole("button", { name: "Retry save", exact: true }).click()
  await saved
  assert.equal(await read(), "Keep this unsaved draft")

  saved = saveResponse()
  await notes.fill("")
  await notes.press("Control+Enter")
  await saved
  assert.equal(await read(), "")
  saved = saveResponse()
  await notes.fill(text)
  await notes.press("Control+Enter")
  await saved
  await preview.close()
  await backend.stop()
  backend = await data.start()
  preview = await browserPreview(backend)
  await open()
  assert.equal(await notes.inputValue(), text)
  await page.setViewportSize({ width: 720, height: 800 })
  assert(await overview.evaluate((element) => element.scrollWidth <= element.clientWidth))
  await page.screenshot({ path: join(output, "overview-narrow.png"), animations: "disabled" })
  await page.setViewportSize({ width: 1200, height: 820 })
  await overview.getByRole("button", { name: "Add tags", exact: true }).click()
  await page.getByRole("dialog", { name: "Add tags" }).waitFor()
  await page.screenshot({ path: join(output, "tag-picker.png"), animations: "disabled" })
  assert.deepEqual(errors, [])
  console.log(`PASS Overview: tags, notes autosave/clear/reload/restart, captured Entity, failed draft/retry, narrow layout. ${output}`)
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png"), animations: "disabled" }).catch(() => {})
  throw error
} finally {
  await browser.close()
  await preview.close()
  await backend.stop()
  await data.dispose()
}
