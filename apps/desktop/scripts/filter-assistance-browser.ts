import assert from "node:assert/strict"
import { join } from "node:path"
import type { Page, Locator } from "playwright"
import type { components } from "@locus/client"

export async function checkFilterAssistance(page: Page, dialog: Locator, source: Locator,
  catalogue: components["schemas"]["SearchCatalogueBody"], output: string) {
  const panel = page.locator("#filter-assistance")
  const type = async (text: string) => {
    await source.fill("")
    await source.pressSequentially(text)
  }
  const exited = () => panel.waitFor({ state: "hidden" })
  const field = catalogue.fields.find((f) => f.id === "civitai_file_name")!
  assert(field && field.assistance === "strings")

  await source.fill("@civitai_file_name:literal")
  assert.equal(await panel.count(), 0, "A pasted marker is literal")
  await source.fill('civitai_file_name:"')
  await source.pressSequentially("@")
  await panel.waitFor({ state: "hidden" })
  assert.equal(await source.inputValue(), 'civitai_file_name:"@')

  // Hold an obsolete lexical reply while newer direct typing completes.
  let release!: () => void, received!: () => void, delivered!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const request = new Promise<void>((resolve) => { received = resolve })
  const delivery = new Promise<void>((resolve) => { delivered = resolve })
  let first = true
  await page.route("**/api/v1/filter/editing", async (route) => {
    if (!first) { await route.continue(); return }
    first = false
    const response = await route.fetch()
    received(); await held; await route.fulfill({ response }); delivered()
  })
  await type("@")
  await request
  await source.pressSequentially("civitai_file_name")
  await panel.getByRole("button", { name: "Use field civitai_file_name", exact: true }).waitFor()
  release()
  await delivery
  await page.unroute("**/api/v1/filter/editing")
  await source.press("Tab")
  await page.waitForFunction((reference) => (document.getElementById("filter-source") as HTMLTextAreaElement)?.value === `@${reference}:`, field.native_exact)
  const observed = panel.getByRole("button", { name: /^Use value / })
  await observed.first().waitFor()
  const candidate = await observed.first().getAttribute("aria-label")
  assert(candidate)
  const popupBox = await panel.boundingBox(), inputBox = await source.boundingBox()
  assert(popupBox && inputBox && popupBox.x >= inputBox.x && popupBox.y < inputBox.y + inputBox.height,
    "Completion floats next to the first input line, not below the textarea")
  await page.screenshot({ path: join(output, "filter-assistance-popup.png"), animations: "disabled" })
  const original = candidate.slice("Use value ".length)
  await observed.first().click()
  await page.waitForFunction(() => (document.getElementById("filter-source") as HTMLTextAreaElement)?.value.includes(':"'))
  assert((await source.inputValue()).includes(original))
  await page.screenshot({ path: join(output, "filter-assistance-values.png"), animations: "disabled" })
  await source.press("Enter")
  await exited()
  assert((await source.inputValue()).startsWith(`${field.native_exact}:"`))

  // Positioning follows the actual multiline textarea without moving its dialog.
  await source.fill("")
  const beforePopup = await dialog.boundingBox()
  await source.pressSequentially(`@${field.native_exact}:`)
  await observed.first().waitFor()
  const firstLine = await panel.boundingBox(), stableDialog = await dialog.boundingBox()
  assert(beforePopup && stableDialog && Math.abs(beforePopup.height - stableDialog.height) < 2,
    "Opening completion must not grow or recenter the modal")
  await source.fill("entity_id:*\nAND\n")
  await source.pressSequentially(`@${field.native_exact}:`)
  await observed.first().waitFor()
  const thirdLine = await panel.boundingBox()
  assert(firstLine && thirdLine && thirdLine.y > firstLine.y + 25,
    "The menu follows newlines to the current input line")
  await page.screenshot({ path: join(output, "filter-assistance-multiline.png"), animations: "disabled" })
  await source.fill('entity_id:*\nAND '.repeat(40))
  await source.pressSequentially(`@${field.native_exact}:`)
  await observed.first().waitFor()
  const sourceScroll = await source.evaluate((element: HTMLTextAreaElement) => element.scrollTop)
  assert(sourceScroll > 0, "The multiline fixture scrolls the real textarea")
  await source.evaluate((element: HTMLTextAreaElement) => { element.scrollTop = 0 })
  await panel.waitFor({ state: "hidden" })
  await source.evaluate((element: HTMLTextAreaElement) => { element.scrollTop = element.scrollHeight })
  await observed.first().waitFor()
  assert((await source.inputValue()).includes(`@${field.native_exact}:`), "Scrolling cannot finish the helper")
  await source.press("Escape"); await exited()

  // Native manual text stays unquoted and incomplete syntax stays recoverable.
  await type(`@${field.native_value}:cat girl`)
  await source.press("Enter")
  await exited()
  assert.equal(await source.inputValue(), `${field.native_value}:cat girl`)
  await type(`@${field.native_exact}:"unfinished @ value`)
  await source.press("Enter")
  await exited()
  assert.equal(await source.inputValue(), `${field.native_exact}:"unfinished @ value`)
  await type("@unknown_field:unfinished")
  await source.press("Enter")
  await exited()
  assert.equal(await source.inputValue(), "unknown_field:unfinished")

  // Field replacement uses the owner header span and keeps a complex value.
  await type("@civitai_file_name:[a TO z]")
  const complexLength = (await source.inputValue()).length
  for (let i = 0; i < complexLength - 5; i++) await source.press("ArrowLeft")
  await panel.getByRole("button", { name: "Use field civitai_file_name", exact: true }).click()
  assert.equal(await source.inputValue(), `@${field.native_exact}:[a TO z]`)
  await source.press("Escape"); await exited()
  assert((await source.inputValue()).startsWith("@"))

  await type("@file_byte_count:")
  await panel.getByText(/Observed library range:/).waitFor()
  await page.screenshot({ path: join(output, "filter-assistance-bounds.png"), animations: "disabled" })
  await source.press("Escape"); await exited()

  // Type fields offer observations only; formats expose genuine declared choices.
  await type("@image_format:Jpeg")
  const jpeg = panel.getByRole("button", { name: "Use value Jpeg", exact: true })
  await jpeg.waitFor()
  assert.equal(await jpeg.getAttribute("aria-current"), "true")
  await source.press("Tab")
  await page.waitForFunction(() => (document.getElementById("filter-source") as HTMLTextAreaElement)?.value.endsWith(':"Jpeg"'))
  await source.press("Escape"); await exited()

  // Real bounded traversal with smaller transport batches; no fabricated values.
  await page.route("**/api/v1/search/strings", async (route) => {
    const body = route.request().postDataJSON()
    const response = await route.fetch({ postData: { ...body, limit: 2 } })
    await route.fulfill({ response })
  })
  let captures = 0
  const observe = (request: import("playwright").Request) => {
    if (new URL(request.url()).pathname === "/api/v1/search/observation") captures++
  }
  page.on("request", observe)
  await type(`@${field.native_exact}:`)
  await panel.getByRole("button", { name: "More values", exact: true }).waitFor()
  assert.equal(await observed.count(), 2)
  await panel.getByRole("button", { name: "More values", exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('#filter-assistance button[aria-label^="Use value "]').length > 2)
  assert.equal(captures, 1)
  await source.pressSequentially("no-such-value")
  await panel.getByText("No matching values", { exact: true }).waitFor()
  assert.equal(captures, 1, "One helper reuses its observation across fragments")
  await source.press("Escape"); await exited()
  page.off("request", observe)
  await page.unroute("**/api/v1/search/strings")

  // Discovery faults retain input/static help and require explicit fresh retry.
  await page.route("**/api/v1/search/observation", (route) => route.fulfill({ status: 503,
    json: { code: "unavailable", message: "Injected observation failure" } }))
  await type(`@${field.native_exact}:`)
  await panel.getByText(/Library observation unavailable:/).waitFor()
  await source.pressSequentially("a")
  await panel.getByText(/Library observation unavailable:/).waitFor()
  await panel.getByText("Writing help", { exact: true }).waitFor()
  await page.unroute("**/api/v1/search/observation")
  await panel.getByRole("button", { name: "Refresh values", exact: true }).click()
  await observed.first().waitFor()
  await source.press("Escape"); await exited()

  // IME confirmation is neither candidate selection nor helper completion.
  await type("@civitai_file")
  await panel.getByRole("button", { name: "Use field civitai_file_name", exact: true }).waitFor()
  const beforeIme = await source.inputValue()
  await source.dispatchEvent("compositionstart")
  await source.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229, isComposing: true })
  assert.equal(await source.inputValue(), beforeIme)
  assert(await panel.isVisible())
  await source.dispatchEvent("compositionend")
  await source.press("Escape"); await exited()

  await page.route("**/api/v1/filter/editing", (route) => route.fulfill({ status: 503,
    json: { code: "unavailable", message: "Injected editing failure" } }))
  await type("@unknown_field:")
  await panel.getByText(/Editing assistance unavailable:/).waitFor()
  await page.unroute("**/api/v1/filter/editing")
  await panel.getByRole("button", { name: "Retry assistance", exact: true }).click()
  await panel.getByText(/Editing assistance unavailable:/).waitFor({ state: "hidden" })
  assert.equal(await source.inputValue(), "@unknown_field:")
  await source.press("Escape"); await exited()

  // Expiry retires selectable values. Typing cannot silently switch snapshots.
  await page.route("**/api/v1/search/observation", async (route) => {
    const response = await route.fetch(), body = await response.json()
    await route.fulfill({ response, json: { ...body, expires_after_seconds: 0.2 } })
  })
  await type(`@${field.native_exact}:`)
  await panel.getByText(/Library observation expired/).waitFor()
  await source.pressSequentially("a")
  await panel.getByText(/Library observation expired/).waitFor()
  assert.equal(await observed.count(), 0)
  await page.unroute("**/api/v1/search/observation")
  await panel.getByRole("button", { name: "Refresh values", exact: true }).click()
  await observed.first().waitFor()
  await source.press("Escape"); await exited()

  await page.setViewportSize({ width: 720, height: 480 })
  await type("@")
  await panel.getByRole("button", { name: "Use field entity_id", exact: true }).waitFor()
  for (let i = 0; i < 45; i++) await source.press("ArrowDown")
  const highlighted = panel.locator('button[aria-current="true"]')
  await highlighted.waitFor()
  const highlightedBox = await highlighted.boundingBox(), listBox = await panel.getByLabel("Assisted fields", { exact: true }).boundingBox()
  assert(highlightedBox && listBox && highlightedBox.y >= listBox.y && highlightedBox.y + highlightedBox.height <= listBox.y + listBox.height + 1)
  const compact = await dialog.boundingBox()
  assert(compact && compact.y >= 0 && compact.y + compact.height <= 480)
  const floatingBox = await panel.boundingBox()
  assert(floatingBox && floatingBox.x >= 0 && floatingBox.x + floatingBox.width <= 720 &&
    floatingBox.y >= 0 && floatingBox.y + floatingBox.height <= 480,
    "The floating menu stays inside the small viewport")
  await page.screenshot({ path: join(output, "filter-assistance-minimum.png"), animations: "disabled" })
  await source.press("Enter"); await exited()
  await source.fill("entity_id:*\nAND\n\n\n")
  await source.pressSequentially(`@${field.native_exact}:`)
  await observed.first().waitFor()
  await page.waitForFunction(() => document.getElementById("filter-assistance")?.getAttribute("data-side") === "top")
  await page.screenshot({ path: join(output, "filter-assistance-flipped.png"), animations: "disabled" })
  await source.press("Escape"); await exited()
  await page.setViewportSize({ width: 1200, height: 800 })

  await type("@unknown_field:")
  await panel.getByText("Writing help", { exact: true }).waitFor()
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab")
    if (await dialog.getByRole("button", { name: "Save", exact: true }).evaluate((element) => element === document.activeElement)) break
  }
  await exited()
  assert.equal(await source.inputValue(), "@unknown_field:", "Ordinary focus departure keeps the marker")

  // Direct actions complete before naming, including cancellation. An earlier
  // literal departure makes later Save As retain its ordinary marker.
  await type("@unknown_field:")
  await dialog.getByRole("button", { name: "Save As", exact: true }).click()
  const naming = page.getByRole("dialog", { name: "Save As", exact: true })
  await naming.waitFor()
  assert.equal(await page.locator("#filter-source").inputValue(), "unknown_field:")
  await naming.getByRole("button", { name: "Cancel", exact: true }).click()
  await type("@unknown_field:")
  await source.press("Escape"); await exited()
  await dialog.getByRole("button", { name: "Save As", exact: true }).click()
  await naming.waitFor()
  assert.equal(await page.locator("#filter-source").inputValue(), "@unknown_field:")
  await naming.getByRole("button", { name: "Cancel", exact: true }).click()
  await type("@unknown_field:")
  await dialog.getByRole("button", { name: "Save", exact: true }).click()
  const saveName = page.getByRole("dialog", { name: "Save preset", exact: true })
  await saveName.waitFor()
  assert.equal(await page.locator("#filter-source").inputValue(), "unknown_field:")
  await saveName.getByRole("button", { name: "Cancel", exact: true }).click()
  await type("@unknown_field:")
  await dialog.getByRole("button", { name: "New", exact: true }).click()
  await page.getByRole("dialog", { name: "Unsaved Filter edits" }).getByRole("button", { name: "Cancel", exact: true }).click()
  assert.equal(await source.inputValue(), "@unknown_field:")
  await type("@entity_id:*")
  await dialog.getByRole("button", { name: "Apply", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  await page.getByRole("button", { name: /^Filter(?: · applied)?$/ }).click()
  assert.equal(await source.inputValue(), "entity_id:*")
  await source.fill("")
}
