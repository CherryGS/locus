import assert from "node:assert/strict"
import { join } from "node:path"
import { chromium } from "playwright"
import { fixture, outputDirectory } from "./fixture.ts"
import { browserPreview } from "./browser-preview.ts"

const data = await fixture()
const backend = await data.start()
const preview = await browserPreview(backend)
const output = await outputDirectory("tag-stability")
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
const errors: string[] = []
page.on("pageerror", (error) => errors.push(error.message))
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
try {
  const create = async (name: string, parent?: string) => {
    const result = await backend.client.POST("/api/v1/tags", { body: {
      request_id: crypto.randomUUID(), change: { operation: "create", name, parent },
    } })
    assert(result.data?.status === "tag_saved")
    return result.data.tag.id
  }
  const root = await create("Work")
  for (let i = 0; i < 35; i++) await create(`Item ${String(i).padStart(2, "0")}`, root)
  const id = data.images[0].entityId
  await page.goto(`${preview.origin}/#/entity?mode=inspect&entityId=${id}`)
  await page.locator('[data-slot="image-viewport"][data-state="ready"]').waitFor()
  await page.getByRole("button", { name: "Overview", exact: true }).click()
  const overview = page.getByRole("complementary", { name: "Overview", exact: true })
  await overview.getByRole("button", { name: "Add tags", exact: true }).click()
  const modal = page.getByRole("dialog", { name: "Tags", exact: true })
  await modal.getByRole("button", { name: "Expand Work", exact: true }).click()
  const unrelated = modal.getByRole("button", { name: "Add Item 26", exact: true })
  const requests: string[] = []
  page.on("request", (request) => requests.push(`${request.method()} ${new URL(request.url()).pathname}`))
  for (const action of ["Add", "Remove"]) {
    const write = deferred(), read = deferred(), wrote = deferred(), reading = deferred()
    await page.route("**/api/v1/tags", async (route) => {
      if (route.request().method() === "POST") { wrote.resolve(); await write.promise }
      await route.continue()
    })
    await page.route(`**/api/v1/entities/${id}/tags`, async (route) => {
      reading.resolve()
      await read.promise
      await route.continue()
    })
    const target = modal.getByRole("button", { name: `${action} Item 25`, exact: true })
    await target.scrollIntoViewIfNeeded()
    await target.focus()
    requests.length = 0
    // Keep the frame sampler as browser source so tsx's function-name helper
    // is not captured in the serialized evaluate callback.
    await page.evaluate(`((dialog) => {
      const target = dialog.querySelector('button[aria-label$=" Item 25"]')
      const viewport = dialog.querySelector('[aria-label="Available tags"]')
      const baseline = dialog.getBoundingClientRect()
      const scroll = viewport.scrollTop
      const image = document.querySelector('[data-slot="image-viewport"] img')
      const imageSrc = image?.src
      const result = { running: true, frames: 0, failures: [] }
      window.tagStability = result
      window.tagStabilityTarget = target
      const sample = () => {
        if (!result.running) return
        result.frames++
        const current = dialog.getBoundingClientRect()
        if (["x", "y", "width", "height"].some((key) => Math.abs(current[key] - baseline[key]) > 1))
          result.failures.push("dialog moved or resized")
        if (!target.isConnected || document.activeElement !== target) result.failures.push("control remounted or focus lost")
        if (viewport.scrollTop !== scroll) result.failures.push("scroll position changed")
        if (image && (!image.isConnected || image.src !== imageSrc)) result.failures.push("image resource changed")
        if (dialog.textContent?.includes("Tag changes are unavailable")) result.failures.push("global loading feedback appeared")
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })([...document.querySelectorAll('[data-slot="dialog-content"]')].find(element => element.getBoundingClientRect().width > 0))`)
    await target.click()
    await wrote.promise
    await page.waitForTimeout(180)
    assert(await target.isDisabled())
    assert(await unrelated.isEnabled())
    await page.keyboard.press("Space")
    write.resolve()
    await reading.promise
    await page.waitForTimeout(180)
    assert(await target.isDisabled(), "Only the original pair stays busy while its observation catches up")
    assert(await unrelated.isEnabled())
    await page.screenshot({ path: join(output, `${action.toLowerCase()}-pending.png`), animations: "disabled" })
    read.resolve()
    const updated = modal.getByRole("button", { name: `${action === "Add" ? "Remove" : "Add"} Item 25`, exact: true })
    await updated.waitFor()
    await page.waitForFunction(() => (window as any).tagStabilityTarget.getAttribute("aria-busy") === "false")
    const frames = await page.evaluate(() => { (window as any).tagStability.running = false; return (window as any).tagStability })
    assert(frames.frames > 5)
    assert.deepEqual([...new Set(frames.failures)], [], action)
    assert.deepEqual(requests, ["POST /api/v1/tags", `GET /api/v1/entities/${id}/tags`], "No duplicate write or unrelated metadata/vocabulary reload")
    await page.unrouteAll({ behavior: "wait" })
  }
  await page.keyboard.press("Escape")
  await modal.waitFor({ state: "hidden" })
  const entityId = overview.getByRole("region", { name: "Entity ID", exact: true }).getByText(id, { exact: true })
  await entityId.waitFor()
  assert.equal(await entityId.evaluate(element => getComputedStyle(element).userSelect), "text")
  assert.equal(await overview.getByRole("button", { name: "Copy entity id", exact: true }).count(), 0)
  assert.equal(await overview.getByRole("button", { name: "Entity ID", exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log(`PASS Stable tag edits: delayed add/remove, fixed bounds/scroll/focus, unrelated controls/resources preserved, local reads only. ${output}`)
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png"), animations: "disabled" }).catch(() => {})
  throw error
} finally {
  await browser.close()
  await preview.close()
  await data.dispose()
}
