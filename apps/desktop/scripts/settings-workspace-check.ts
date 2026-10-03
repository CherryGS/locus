import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium } from "playwright"
import { MediaToolPathsGroupId } from "@locus/client"
import { fixture, outputDirectory } from "./fixture.ts"
import { browserPreview } from "./browser-preview.ts"

const data = await fixture(250)
const backend = await data.start()
const preview = await browserPreview(backend)
const output = await outputDirectory("settings-workspace")
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
page.setDefaultTimeout(15_000)
const errors: string[] = []
page.on("pageerror", (error) => errors.push(error.message))
const category = (name: string) => page.getByRole("button", { name, exact: true }).click()
const visit = () => page.evaluate(() => ({ key: history.state.__TSR_key, index: history.state.__TSR_index }))
const enter = () => page.getByRole("button", { name: "Setting", exact: true }).click()
const close = async () => {
  await page
    .getByRole("dialog", { name: "Settings", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click()
  await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor({ state: "hidden" })
}
let releaseSave = () => {}
try {
  await page.goto(`${preview.origin}/#/entity`)
  const grid = page.getByRole("grid", { name: "Entities" })
  await grid.waitFor()
  await grid.evaluate((element) => {
    element.scrollTop = 1300
  })
  await page.waitForFunction(() => document.querySelector('[role="grid"]')!.scrollTop > 1200)
  const cell = grid.getByRole("gridcell").filter({ visible: true }).nth(8)
  await cell.click()
  await page.getByRole("button", { name: "Overview", exact: true }).click()
  const selected = await grid.locator('[aria-selected="true"]').getAttribute("id")
  const selectedUrl = page.url()
  const originVisit = await visit()
  const gridNode = await grid.elementHandle()
  const position = await grid.evaluate((element) => element.scrollTop)
  const anchorIdentity = await grid.evaluate((element) => {
    const top = element.getBoundingClientRect().top
    const cell = [...element.querySelectorAll('[role="gridcell"]')].find(
      (cell) => cell.getBoundingClientRect().top >= top,
    )
    return cell!.id.slice(-36)
  })
  await enter()
  await page.getByRole("heading", { name: "External connection", exact: true }).waitFor()
  const restart = page.getByRole("button", { name: "Restart application", exact: true })
  assert.equal(await restart.count(), 1)
  assert(await restart.evaluate(button => !!button.closest('header')?.querySelector('[data-slot="dialog-title"]')))
  assert.equal(await page.getByLabel("Settings workspace").getByRole("button", { name: "Restart application", exact: true }).count(), 0)
  await category("Library")
  assert(await restart.isVisible())
  await page.getByText("Preview configuration", { exact: true }).waitFor()
  await page.getByText(data.library, { exact: true }).waitFor()
  await category("External connection")
  const settingsVisit = await visit()
  assert.equal(page.url(), selectedUrl, "opening Settings cannot navigate away")
  assert.deepEqual(settingsVisit, originVisit)
  assert.equal(await page.getByRole("button", { name: "Return", exact: true }).count(), 0)
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[role="dialog"][data-open]')!.getBoundingClientRect()
    return Math.abs(dialog.width - innerWidth * 0.9) < 2 && Math.abs(dialog.height - innerHeight * 0.9) < 2
  })
  await page.mouse.click(4, 4)
  await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor({ state: "hidden" })
  assert.equal(page.url(), selectedUrl, "backdrop dismissal preserves the current page")
  await enter()
  await page.keyboard.press("Alt+ArrowLeft")
  assert.equal(page.url(), selectedUrl, "background navigation shortcuts cannot run inside Settings")
  await page.getByLabel("Saved address", { exact: true }).fill("127.0.0.1:46323")
  await category("Media tools")
  assert(await restart.isVisible())
  await page.getByLabel("ffprobe", { exact: true }).fill("workspace-probe")
  await category("External connection")
  assert.deepEqual(await visit(), settingsVisit, "categories cannot add/replace visits")
  assert.equal(await page.getByLabel("Saved address", { exact: true }).inputValue(), "127.0.0.1:46323")
  await page.mouse.click(4, 4)
  await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor({ state: "hidden" })
  await grid.waitFor()
  assert.equal(page.url(), selectedUrl)
  assert(await gridNode!.evaluate((node) => node.isConnected), "grid must remain mounted")
  assert.deepEqual(await visit(), originVisit)
  await page.getByRole("complementary", { name: "Overview", exact: true }).waitFor()
  await page.waitForFunction(
    (position) => Math.abs(document.querySelector('[role="grid"]')!.scrollTop - position) < 2,
    position,
  )
  assert.equal(
    (await grid.locator('[aria-selected="true"]').getAttribute("id"))?.split("-").slice(-5).join("-"),
    selected?.split("-").slice(-5).join("-"),
  )
  assert.match(
    (await page.getByRole("button", { name: "Setting", exact: true }).getAttribute("title")) ?? "",
    /Unsaved edits/,
  )
  await enter()
  await page.getByRole("heading", { name: "External connection", exact: true }).waitFor()
  assert.deepEqual(await visit(), settingsVisit)

  await page.setViewportSize({ width: 900, height: 720 })
  await close()
  await grid.waitFor()
  await page.waitForFunction((identity) => {
    const grid = document.querySelector('[role="grid"]')!
    const anchor = grid.querySelector(`[id$="${identity}"]`)
    if (!anchor) return false
    const rect = anchor.getBoundingClientRect(),
      viewport = grid.getBoundingClientRect()
    return rect.bottom > viewport.top && rect.top < viewport.bottom
  }, anchorIdentity)
  assert.equal(page.url(), selectedUrl, "resized restoration cannot replace selection")
  await enter()
  await page.getByRole("heading", { name: "External connection", exact: true }).waitFor()
  await page.setViewportSize({ width: 1200, height: 800 })

  // A held real commit can finish offscreen, alongside a newer draft.
  await category("Media tools")
  const held = new Promise<void>((resolve) => {
    releaseSave = resolve
  })
  let writes = 0
  await page.route(`**/api/v1/settings/groups/${MediaToolPathsGroupId}*`, async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    writes++
    const response = await route.fetch()
    await held
    await route.fulfill({ response })
  })
  await category("Save")
  await page.getByLabel("ffprobe", { exact: true }).fill("newer-workspace-probe")
  await category("External connection")
  await page
    .getByRole("navigation", { name: "Settings categories" })
    .getByText(/Saving/)
    .waitFor()
  releaseSave()
  await page
    .getByRole("navigation", { name: "Settings categories" })
    .getByText(/Restart required/)
    .waitFor()
  await category("Media tools")
  assert.equal(await page.getByLabel("ffprobe", { exact: true }).inputValue(), "newer-workspace-probe")
  await page.getByText("Saved · restart required", { exact: true }).waitFor()
  await page.getByText(/Saved for next run: ffprobe workspace-probe/).waitFor()
  assert.equal(writes, 1)
  await page.unroute(`**/api/v1/settings/groups/${MediaToolPathsGroupId}*`)

  // Failed offscreen work remains attributable and does not consume the other draft.
  await page.route(`**/api/v1/settings/groups/${MediaToolPathsGroupId}*`, async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    await route.fulfill({
      status: 400,
      json: { code: "invalid_request", message: "Workspace rejected save" },
    })
  })
  await category("Save")
  await category("External connection")
  await page
    .getByRole("navigation", { name: "Settings categories" })
    .getByText(/Needs attention/)
    .waitFor()
  const beforeToken = (await backend.client.GET("/api/v1/external-access/token")).data!
  await category("Reset shared Token")
  await page.waitForFunction(() => !!(document.querySelector("#external-token") as HTMLInputElement)?.value)
  const afterToken = (await backend.client.GET("/api/v1/external-access/token")).data!
  assert(beforeToken.status === "current" && afterToken.status === "current")
  assert.notEqual(beforeToken.revision, afterToken.revision)
  assert.equal(await page.getByLabel("Saved address", { exact: true }).inputValue(), "127.0.0.1:46323")
  await category("Media tools")
  await page.getByText("Workspace rejected save", { exact: false }).waitFor()
  assert.equal(await page.getByLabel("ffprobe", { exact: true }).inputValue(), "newer-workspace-probe")
  await page.unroute(`**/api/v1/settings/groups/${MediaToolPathsGroupId}*`)
  await page.screenshot({ path: join(output, "media-problem.png") })

  // Closing Settings keeps inspection intact; viewer Return remains a separate navigation.
  await close()
  await grid.locator('[aria-selected="true"]').dblclick()
  await page.locator('[data-slot="entity-inspection"]').waitFor()
  const inspectionUrl = page.url()
  const inspectionVisit = await visit()
  const inspectionNode = await page.locator('[data-slot="entity-inspection"]').elementHandle()
  await enter()
  await category("External connection")
  await close()
  await page.locator('[data-slot="entity-inspection"]').waitFor()
  assert.equal(page.url(), inspectionUrl)
  assert.deepEqual(await visit(), inspectionVisit)
  assert(await inspectionNode!.evaluate((node) => node.isConnected), "reader must remain mounted")
  await enter()
  await page.keyboard.press("Escape")
  await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor({ state: "hidden" })
  assert.equal(page.url(), inspectionUrl, "Escape closes only Settings, not the underlying reader")
  assert.equal(await page.locator(":focus").getAttribute("id"), "settings-trigger")
  await category("Return to source")
  await grid.waitFor()
  assert.notEqual(
    (await visit()).key,
    originVisit.key,
    "source return retains its distinct new-navigation meaning",
  )

  // Unknown recorded targets stay unknown after the Settings excursion.
  await page.goto(
    `${preview.origin}/#/entity?mode=inspect&collectionId=library&entityId=00000000-0000-4000-8000-000000000000`,
  )
  await page.getByText("Entity unavailable in this list", { exact: true }).waitFor()
  const unavailableUrl = page.url()
  await enter()
  await close()
  await page.getByText("Entity unavailable in this list", { exact: true }).waitFor()
  assert.equal(page.url(), unavailableUrl)

  await page.getByRole("link", { name: "Home", exact: true }).click()
  await page.getByRole("heading", { name: "Home", exact: true }).waitFor()
  const homeVisit = await visit()
  await enter()
  await close()
  assert.deepEqual(await visit(), homeVisit)
  await page.getByRole("heading", { name: "Home", exact: true }).waitFor()

  await page.goto(`${preview.origin}/#/setting`)
  await page.getByRole("heading", { name: "External connection", exact: true }).waitFor()
  await page.keyboard.press("Tab")
  assert(await page.locator(":focus").evaluate((element) => !!element.closest('[role="dialog"]')))
  await close()
  await grid.waitFor()
  assert.deepEqual(errors, [])
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        checks: [
          "scrolled selected grid and inspector",
          "category history identity",
          "modal preserves URL, history and DOM identity",
          "retained independent drafts",
          "offscreen committed and failed saves",
          "new draft plus pending application",
          "independent Token reset",
          "inspection source semantics",
          "unavailable target",
          "fresh Settings entry",
        ],
      },
      null,
      2,
    ),
  )
  console.log(JSON.stringify({ passed: true, output }))
} finally {
  releaseSave()
  await browser.close()
  await preview.close()
  await data.dispose()
}
