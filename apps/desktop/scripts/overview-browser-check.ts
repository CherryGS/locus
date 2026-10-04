import { workspaceLocation } from "./workspace-browser.ts"
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
const notesStatus = overview.getByRole("region", { name: "Entity notes" }).getByRole("status")
const watchFeedback = async () => page.evaluate(`(() => {
  const root=document.querySelector('section[aria-label="Entity notes"]');
  const status=root.querySelector('[role="status"]'), input=root.querySelector('textarea');
  const icons=[...status.querySelectorAll('svg')], bounds=status.getBoundingClientRect();
  const result={states:[],failures:[]};
  const sample=()=>{
    const text=status.textContent.trim();if(result.states.at(-1)!==text)result.states.push(text);
    const next=status.getBoundingClientRect();
    if(next.width!==bounds.width||next.height!==bounds.height)result.failures.push('status bounds changed');
    if(!input.isConnected||icons.some(icon=>!icon.isConnected))result.failures.push('notes or status icon remounted');
  };
  const observer=new MutationObserver(sample);observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true});
  sample();window.notesFeedback={result,observer};
})()`)
const feedback = async () => page.evaluate(`(() => {
  const {result,observer}=window.notesFeedback;observer.disconnect();delete window.notesFeedback;return result;
})()`) as Promise<{ states: string[]; failures: string[] }>
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
  let inspiration: string | undefined
  for (const name of ["Inspiration", "Composition", "Warm light", "待整理", "Photography"]) {
    const parent = ["Composition", "Warm light"].includes(name) ? inspiration : undefined
    const tag = await backend.client.POST("/api/v1/tags", { body: { request_id: crypto.randomUUID(), change: { operation: "create", name, parent } } })
    assert(tag.data?.status === "tag_saved")
    if (name === "Inspiration") inspiration = tag.data.tag.id
    await backend.client.POST("/api/v1/tags", { body: { request_id: crypto.randomUUID(), change: { operation: "add", tag_id: tag.data.tag.id, entity_id: entity } } })
  }
  await backend.client.POST("/api/v1/tags", { body: { request_id: crypto.randomUUID(), change: { operation: "create", name: "Color studies", parent: inspiration } } })
  await open()
  assert.equal(await notes.inputValue(), "")
  assert.equal(await page.getByRole("button", { name: "Tags", exact: true }).count(), 0)
  const text = "留意画面里的光影层次。\nA reference for the next collection.\nhttps://example.com/reference"
  let saved = saveResponse()
  await notes.click()
  await watchFeedback()
  await notes.fill(text)
  await saved
  await page.waitForFunction(() => document.querySelector('section[aria-label="Entity notes"] [role="status"]')?.textContent?.trim() === "")
  const fast = await feedback()
  assert.deepEqual(fast.failures, [])
  assert(!fast.states.includes("Saving…"), JSON.stringify(fast))
  assert(!fast.states.includes("Saved"), JSON.stringify(fast))
  assert(await notes.evaluate(element => element === document.activeElement))
  assert.equal(await read(), text)
  await page.screenshot({ path: join(output, "overview.png"), animations: "disabled" })
  await notes.press("ArrowRight")
  assert((await workspaceLocation(page)).includes(entity), "Typing shortcuts must not navigate")
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
  await watchFeedback()
  await notesStatus.getByText("Saving…", { exact: true }).waitFor()
  assert(await notes.isEnabled())
  assert(await notes.evaluate(element => element === document.activeElement))
  assert.deepEqual((await feedback()).failures, [])
  await page.getByRole("button", { name: "Next entity", exact: true }).click()
  await page.locator(`[data-slot="entity-inspection"][data-entity-id="${second}"]`).waitFor()
  release()
  await saved
  await page.unrouteAll({ behavior: "wait" })
  assert.equal(await read(), "Saved to the original Entity")
  assert.equal(await read(second), "")
  await page.getByRole("button", { name: "Previous entity", exact: true }).click()
  await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>("textarea")?.value === "Saved to the original Entity")

  // A retained note stays readable while its reread takes longer than usual.
  let releaseRead!: () => void
  const readGate = new Promise<void>(resolve => { releaseRead = resolve })
  await page.route(`**${path}`, async route => {
    if (route.request().method() === "GET") await readGate
    await route.continue()
  })
  await page.getByRole("button", { name: "Overview", exact: true }).click()
  await page.getByRole("button", { name: "Overview", exact: true }).click()
  await notes.waitFor()
  await watchFeedback()
  await notesStatus.getByText("Refreshing…", { exact: true }).waitFor()
  assert.equal(await notes.inputValue(), "Saved to the original Entity")
  assert.equal(await notes.evaluate(element => getComputedStyle(element).opacity), "1")
  const retained = await feedback()
  assert.deepEqual(retained.failures, [])
  assert(!retained.states.includes("Loading…"), JSON.stringify(retained))
  releaseRead()
  await page.waitForFunction(() => document.querySelector('section[aria-label="Entity notes"] [role="status"]')?.textContent?.trim() === "")
  await page.unrouteAll({ behavior: "wait" })

  await page.route(`**${path}`, (route) => route.request().method() === "PUT"
    ? route.fulfill({ status: 500, json: { code: "operation_failed", message: "Temporary notes failure" } })
    : route.continue())
  await notes.fill("Keep this unsaved draft")
  await overview.getByText("Temporary notes failure", { exact: true }).waitFor()
  await page.getByRole("button", { name: "Overview", exact: true }).click()
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
  await page.getByRole("dialog", { name: "Tags", exact: true }).waitFor()
  await page.getByRole("button", { name: "Expand Inspiration", exact: true }).click()
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
