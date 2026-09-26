import assert from "node:assert/strict"
import { join } from "node:path"
import { chromium } from "playwright"
import { twitterFixture } from "./twitter-fixture.ts"
import { browserPreview } from "./browser-preview.ts"
import { outputDirectory } from "./fixture.ts"
import { chooseContentView } from "./content-view-choice.ts"

const data = await twitterFixture()
const backend = await data.start()
const preview = await browserPreview(backend)
const output = await outputDirectory("notifications")
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1005, height: 984 } })
  page.setDefaultTimeout(10000)
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const entity = data.entries.find((entry) => entry.name === "complete")!
  await page.goto(`${preview.origin}/#/entity`)
  await page.locator(`[role="gridcell"][id$="-${entity.entityId}"]`).dblclick()
  await page.getByRole("button", { name: "Overview", exact: true }).click()
  await chooseContentView(page, "Twitter")
  const trigger = page.getByRole("button", { name: /^Notifications/ })
  await trigger.click()
  const inbox = page.getByRole("dialog", { name: "Notifications", exact: true })
  await inbox.getByText("No notifications yet").waitFor()
  await page.keyboard.press("Escape")
  await inbox.waitFor({ state: "hidden" })
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true)
  await page.getByRole("link", { name: "View original post", exact: true }).click()
  await page.locator('[data-slot="toast"]').getByText("Couldn't open link", { exact: true }).waitFor()
  await page.getByRole("button", { name: "Notifications · 1 unread", exact: true }).waitFor()
  // Let the normal timeout dismiss the transient toast; history must outlive it.
  await page.locator('[data-slot="toast"]').waitFor({ state: "detached" })
  await trigger.click()
  await inbox.getByText("Couldn't open link", { exact: true }).waitFor()
  assert.equal(await inbox.getByRole("button", { name: "Retry opening link" }).count(), 0)
  assert.equal(await trigger.getAttribute("aria-label"), "Notifications")
  await page.screenshot({ path: join(output, "inbox.png"), animations: "disabled" })
  await page.keyboard.press("Escape")
  await page.getByRole("link", { name: "Home", exact: true }).click()
  await trigger.click()
  await inbox.getByText("Couldn't open link", { exact: true }).waitFor()
  await page.setViewportSize({ width: 720, height: 480 })
  const box = await inbox.boundingBox()
  assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 720 && box.y + box.height <= 480)
  await inbox.getByRole("button", { name: "Clear all", exact: true }).click()
  await inbox.getByText("No notifications yet").waitFor()
  await page.keyboard.press("Escape")
  await trigger.click()
  await inbox.getByText("No notifications yet").waitFor()
  assert.deepEqual(errors, [])
  console.log(
    `PASS notification retention, unread state, clearing, route continuity, focus and small viewport. ${output}`,
  )
} finally {
  await browser.close()
  await preview.close()
  await data.dispose()
}
